import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import {
  verifyLineSignature,
  replyMessage,
  pushMessage,
  replyFlexMessage,
  pushFlexMessage,
  getMessageContent,
  getUserProfile,
} from "../_shared/line.ts";
import { createEmbedding, createChatReply } from "../_shared/openai.ts";
import { verifySlipImage, describeSlip2GoCode, type Slip2GoCheckReceiver } from "../_shared/slip2go.ts";
import { parseReplyTemplates, resolveReplyTemplate, type ReplyTemplates } from "../_shared/replyTemplates.ts";
import { buildSlipCard, slipCardAltText } from "./slipCard.ts";

// There is deliberately no distance threshold here any more, and it should not
// come back. Measured against this shop's real document and a real question:
//
//   "เปิดกี่โมง" vs the chunk holding the answer .......... 0.787
//   "เปิดกี่โมง" vs "วิธีเปลี่ยนยางรถยนต์" (unrelated) ....... 0.773
//
// The answer scored *worse* than a car-tyre article. Cosine distance on short
// Thai queries carries about 0.007 of signal between relevant and irrelevant —
// no cut-off can separate them, which is why 0.5 and then 0.65 both rejected
// everything and the bot answered "I don't have that" to a question its own
// document answered in plain text.
//
// The model was always the real relevance judge, and it's a good one. Handed the
// same chunks, gpt-4o-mini answered "เปิดกี่โมง" and "มีที่จอดรถไหม" correctly and
// declined "ขายไอโฟนราคาเท่าไหร่" on its own — every one of which the filter had
// been throwing away. Grounding comes from the system prompt's "use ONLY the
// context", not from arithmetic on vectors.
//
// What still limits blast radius: match_count caps how much context is sent, and
// the canned reply below covers the only case retrieval can be sure about — a
// shop with no documents at all.
const MATCH_COUNT = 5;

// LINE sends no locale on a message event, so the customer's own text is the
// only signal there is. Thai has its own Unicode block, so a single Thai
// character is a reliable tell — no detection library or extra model call.
// Anything else falls back to English rather than guessing.
const THAI_CHARACTER = /[\u0E00-\u0E7F]/;

// The shop can rewrite both sides of this from /settings/ai; resolveReplyTemplate
// falls back to the stock wording for whichever language was picked. Still not
// routed through t(): that lives in the browser, and the language chosen here is
// the *customer's*, which has nothing to do with the language the merchant reads
// their own dashboard in.
function noMatchReply(customerText: string, templates: ReplyTemplates): string {
  return resolveReplyTemplate(
    templates,
    THAI_CHARACTER.test(customerText) ? "chat.no_answer_th" : "chat.no_answer_en"
  );
}

// Slip2Go codes that mean the slip is genuine and (if a receiver was supplied)
// paid to the right account, so points may be credited. Both the image endpoint's
// "Slip found" (bank-verified) and "Slip is valid" count. Fraud (200500),
// receiver mismatch (200401), and duplicates (200501) have their own codes and
// fall through to the rejection path below.
const SLIP_SUCCESS_CODES = new Set(["200000", "200200"]);

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { id?: string; type: string; text?: string };
};

type ShopRow = {
  id: string;
  line_channel_secret: string;
  line_channel_access_token: string;
  liff_id: string | null;
  openai_api_key: string | null;
  reply_templates: unknown;
  points_config: { points_per_baht?: number; points_per_slip?: number; redeem_threshold?: number } | null;
  slip2go_api_secret: string | null;
  slip_receivers: SlipReceiverRow[] | null;
};

// One accepted account (see 0020). A slip paid to ANY of a shop's receivers is
// credited, since Slip2Go's checkReceiver array matches if any entry matches.
type SlipReceiverRow = {
  account_type?: string;
  account_number?: string;
  account_name_th?: string;
  account_name_en?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const shopId = url.pathname.split("/").filter(Boolean).pop();
    if (!shopId) return jsonResponse({ error: "Missing shop id in webhook path" }, { status: 400 });

    const service = createServiceClient();
    const { data: shop, error: shopError } = await service
      .from("shops")
      .select(
        "id, line_channel_secret, line_channel_access_token, liff_id, openai_api_key, reply_templates, " +
          "points_config, slip2go_api_secret, slip_receivers"
      )
      .eq("id", shopId)
      .single<ShopRow>();
    if (shopError || !shop || !shop.line_channel_secret || !shop.line_channel_access_token) {
      return jsonResponse({ error: "Unknown or unconfigured shop" }, { status: 404 });
    }

    // Signature verification requires the exact raw bytes LINE signed —
    // reading req.json() first and re-serializing would change the bytes and
    // always fail.
    const rawBody = await req.text();
    const signature = req.headers.get("X-Line-Signature");
    const valid = await verifyLineSignature(rawBody, signature, shop.line_channel_secret);
    if (!valid) return jsonResponse({ error: "Invalid signature" }, { status: 401 });

    // LINE's payload is trusted (signature-verified above), but a retry, a
    // health-check probe, or anyone who guesses/reuses a shop_id path
    // segment could still send a non-JSON body — fail with a clean 400
    // instead of an unhandled exception.
    let payload: { events?: LineEvent[] };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const events = payload.events ?? [];

    // LINE's "Verify" button in the console sends an empty-events ping.
    if (events.length === 0) return jsonResponse({ ok: true });

    const accessToken = shop.line_channel_access_token;
    const templates = parseReplyTemplates(shop.reply_templates);

    for (const event of events) {
      if (event.type !== "message") continue;
      const userId = event.source?.userId;
      const replyToken = event.replyToken;
      if (!userId || !replyToken) continue;

      // Return 200 to LINE fast; do the slower work (OpenAI calls, or the
      // Slip2Go round-trip) in the background so we don't block on it
      // against LINE's short reply-token expiry window.
      if (event.message?.type === "text" && event.message.text) {
        const text = event.message.text;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime?.waitUntil(
          handleMessage({
            shopId,
            userId,
            text,
            replyToken,
            accessToken,
            apiKey: shop.openai_api_key,
            templates,
          })
        );
      } else if (event.message?.type === "image" && event.message.id) {
        if (!shop.slip2go_api_secret) continue; // slip verification not enabled for this shop
        const messageId = event.message.id;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime?.waitUntil(
          handleSlipImage({ shopId, userId, replyToken, accessToken, messageId, shop, templates })
        );
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("line-webhook failed:", error);
    return jsonResponse({ error: "Internal error" }, { status: 500 });
  }
});

async function handleMessage(params: {
  shopId: string;
  userId: string;
  text: string;
  replyToken: string;
  accessToken: string;
  apiKey: string | null;
  templates: ReplyTemplates;
}) {
  const { shopId, userId, text, replyToken, accessToken, apiKey, templates } = params;
  const service = createServiceClient();

  try {
    const { data: customer } = await service
      .from("customers")
      .select("id")
      .eq("shop_id", shopId)
      .eq("line_user_id", userId)
      .maybeSingle();

    await service.from("chat_logs").insert({
      shop_id: shopId,
      customer_id: customer?.id ?? null,
      direction: "in",
      message_text: text,
    });

    let replyText: string;

    // Every failure below this line ends in the outer catch, which only logs —
    // so anything that throws leaves the customer staring at silence. A shop
    // that hasn't added its OpenAI key yet is a configuration problem, not
    // something to tell the customer about, so it degrades to the same canned
    // reply as "no matching document" instead of throwing into that void.
    if (!apiKey) {
      console.warn(`line-webhook: shop ${shopId} has no openai_api_key — answering with the canned reply`);
      replyText = noMatchReply(text, templates);
    } else {
      const queryEmbedding = await createEmbedding(text, apiKey);
      const { data: matches, error: matchError } = await service.rpc("match_document_chunks", {
        p_shop_id: shopId,
        p_query_embedding: queryEmbedding,
        p_match_count: MATCH_COUNT,
      });
      if (matchError) throw new Error(matchError.message);

      // Still nearest-first from the RPC, so this is "the most relevant few" —
      // just without pretending a cut-off can decide relevance.
      const scored = (matches ?? []) as { distance: number; content: string }[];

      const best = scored.length > 0 ? Math.min(...scored.map((m) => m.distance)) : null;
      console.log(`line-webhook rag: shop=${shopId} chunks=${scored.length} best_distance=${best ?? "n/a"}`);

      if (scored.length === 0) {
        // A shop with no documents at all — the one case retrieval can be sure
        // about, and the only one left for the canned reply.
        replyText = noMatchReply(text, templates);
      } else {
        const context = scored.map((m) => m.content).join("\n---\n");
        // The language line is a *form* instruction, so it doesn't loosen the
        // strict-grounding rule next to it — and it makes the model's own
        // "I don't have that" come out in the customer's language too, which the
        // canned reply above can't cover once a shop has documents. The shop's
        // docs may well be in a different language from the question; answering
        // in the customer's is the point.
        const systemPrompt =
          "You are a helpful assistant for this shop. Answer the customer's question using ONLY the context " +
          "below. If the answer isn't in the context, say you don't have that information. " +
          "Always reply in the same language the customer wrote their question in.\n\nContext:\n" + context;
        replyText = await createChatReply(systemPrompt, text, apiKey);
      }
    }

    try {
      await replyMessage(accessToken, replyToken, replyText);
    } catch {
      // Reply token likely expired while we were generating — fall back to push.
      await pushMessage(accessToken, userId, replyText);
    }

    await service.from("chat_logs").insert({
      shop_id: shopId,
      customer_id: customer?.id ?? null,
      direction: "out",
      message_text: replyText,
    });
  } catch (error) {
    console.error("line-webhook handleMessage failed:", error);
  }
}

async function handleSlipImage(params: {
  shopId: string;
  userId: string;
  replyToken: string;
  accessToken: string;
  messageId: string;
  shop: ShopRow;
  templates: ReplyTemplates;
}) {
  const { shopId, userId, replyToken, accessToken, messageId, shop, templates } = params;
  const service = createServiceClient();

  async function reply(text: string) {
    try {
      await replyMessage(accessToken, replyToken, text);
    } catch {
      await pushMessage(accessToken, userId, text);
    }
  }

  // Points are credited before we get here, so a card that fails to render must
  // never mean the customer hears nothing at all. Every failure path degrades to
  // the plain-text version of the same news.
  async function replyCard(altText: string, contents: unknown) {
    try {
      await replyFlexMessage(accessToken, replyToken, altText, contents);
      return;
    } catch {
      // Reply token spent, or LINE rejected the payload — try pushing the card.
    }
    try {
      await pushFlexMessage(accessToken, userId, altText, contents);
    } catch {
      await reply(altText);
    }
  }

  try {
    // Ensure a customer row exists for this LINE user even if they never
    // went through the LIFF registration flow — the webhook's own signature
    // check already establishes this is a genuine LINE-originated event, a
    // separate but equally valid trust path from the LIFF id_token check.
    let { data: customer } = await service
      .from("customers")
      .select("id, points_balance")
      .eq("shop_id", shopId)
      .eq("line_user_id", userId)
      .maybeSingle();

    if (!customer) {
      const profile = await getUserProfile(accessToken, userId);
      const { data: created, error: createError } = await service
        .from("customers")
        .insert({
          shop_id: shopId,
          line_user_id: userId,
          display_name: profile?.displayName ?? null,
          picture_url: profile?.pictureUrl ?? null,
        })
        .select("id, points_balance")
        .single();
      if (createError || !created) throw new Error(createError?.message ?? "Failed to create customer");
      customer = created;
    }

    const imageBytes = await getMessageContent(accessToken, messageId);

    // Every configured account becomes one checkReceiver condition; Slip2Go
    // accepts the slip if it matches any one (match-any confirmed against a live
    // KShop slip). An account_type/number is all a match needs — KShop accounts
    // (type "03000") carry no bank account number, only a Merchant ID, so we
    // never require one. With no receivers configured Slip2Go only vouches the
    // slip is genuine, not who it was paid to (the merchant-app warns of this).
    const configuredReceivers = (shop.slip_receivers ?? []).filter(
      (r) => r.account_type && r.account_number
    );
    const checkReceiver: Slip2GoCheckReceiver[] | undefined =
      configuredReceivers.length > 0
        ? configuredReceivers.map((r) => ({
            accountType: r.account_type ?? "",
            accountNumber: r.account_number,
            accountNameTH: r.account_name_th ?? undefined,
            accountNameEN: r.account_name_en ?? undefined,
          }))
        : undefined;

    const result = await verifySlipImage(imageBytes, shop.slip2go_api_secret!, {
      checkReceiver,
      checkDuplicate: true,
    });

    if (!SLIP_SUCCESS_CODES.has(result.code)) {
      await service.from("slip_verifications").insert({
        shop_id: shopId,
        customer_id: customer.id,
        slip2go_code: result.code,
        status: result.code.startsWith("500") ? "error" : "rejected",
        raw_response: result,
      });
      await reply(describeSlip2GoCode(result.code, templates));
      return;
    }

    const amount = result.data?.amount ?? 0;
    // Flat per-slip crediting takes precedence when `points_per_slip` is set
    // (GGWP: 1 point per verified slip regardless of amount); otherwise fall
    // back to amount-based crediting via `points_per_baht`. `amount` is still
    // recorded in `slip_verifications` below as the audit trail either way.
    const config = shop.points_config ?? {};
    const pointsToAward =
      typeof config.points_per_slip === "number"
        ? config.points_per_slip
        : Math.floor(amount * (config.points_per_baht ?? 1));

    // The unique (shop_id, trans_ref) constraint is the real idempotency
    // guard — Slip2Go's own checkDuplicate is a second layer, not a
    // substitute, since it's scoped to Slip2Go's own account, not ours.
    const { error: insertError } = await service.from("slip_verifications").insert({
      shop_id: shopId,
      customer_id: customer.id,
      trans_ref: result.data?.transRef ?? null,
      reference_id: result.data?.referenceId ?? null,
      amount,
      sender_name: result.data?.sender?.account?.name ?? null,
      bank_name: result.data?.receiver?.bank?.name ?? null,
      slip2go_code: result.code,
      status: "credited",
      points_awarded: pointsToAward,
      raw_response: result,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        await reply(describeSlip2GoCode("200501", templates)); // "This slip has already been used"
        return;
      }
      throw new Error(insertError.message);
    }

    let newBalance = customer.points_balance;
    if (pointsToAward > 0) {
      const { data } = await service.rpc("apply_points_system", {
        p_customer_id: customer.id,
        p_delta: pointsToAward,
        p_reason: "slip_verified",
      });
      if (typeof data === "number") newBalance = data;
    }

    const cardInput = {
      amount,
      pointsAwarded: pointsToAward,
      balance: newBalance,
      redeemThreshold: typeof config.redeem_threshold === "number" ? config.redeem_threshold : null,
      liffId: shop.liff_id,
    };
    await replyCard(slipCardAltText(cardInput), buildSlipCard(cardInput));
  } catch (error) {
    console.error("line-webhook handleSlipImage failed:", error);
    try {
      await service.from("slip_verifications").insert({
        shop_id: shopId,
        slip2go_code: "error",
        status: "error",
        raw_response: { error: error instanceof Error ? error.message : String(error) },
      });
    } catch {
      // best-effort logging only
    }
    await reply(resolveReplyTemplate(templates, "slip.system_error"));
  }
}
