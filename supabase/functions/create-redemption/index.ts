import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

// Short, human-friendly coupon code (no ambiguous 0/O/1/I/L) so staff can match
// a customer's coupon against the pending-approval list at a glance.
function generateCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token, reward_id } = body as { qr_token?: string; reward_id?: string };
    if (!qr_token || !reward_id) {
      return jsonResponse({ error: "qr_token and reward_id are required" }, { status: 400 });
    }

    // The signed loyalty token is the customer's identity proof — never trust a
    // client-supplied customer_id.
    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid card token" }, { status: 401 });
    }
    const customerId = payload.cid;

    const service = createServiceClient();

    // Same current-card guard every qr_token-authenticated function runs: a
    // valid signature alone doesn't prove the token is still the customer's
    // active card, since these tokens have no expiry.
    const { data: card } = await service
      .from("loyalty_cards")
      .select("qr_token, revoked_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!card || card.revoked_at || card.qr_token !== qr_token) {
      return jsonResponse({ error: "Card not active" }, { status: 401 });
    }

    // Everything else — reward validity, the shop's redeem threshold, the
    // balance check, the deduction and the coupon row — happens inside the RPC
    // under a row lock. Redeeming now spends the points, so those checks are
    // authoritative rather than advisory, and splitting them across this
    // function and the database would reopen the double-spend the lock closes.
    const { data, error } = await service.rpc("create_redemption", {
      p_customer_id: customerId,
      p_reward_id: reward_id,
      p_code: generateCode(),
    });
    if (error) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    const redemption = Array.isArray(data) ? data[0] : data;
    if (!redemption) {
      return jsonResponse({ error: "Failed to create redemption" }, { status: 500 });
    }

    return jsonResponse({ redemption });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
