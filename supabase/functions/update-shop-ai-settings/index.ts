import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";
import { asAiProvider, checkAiKey, type AiProvider } from "../_shared/ai.ts";

// `shops` is only writable by super_admin under RLS, so this is the sanctioned
// path for a shop admin to set their own AI provider + key.
//
// A shop picks openai or gemini (0021). Each provider's key lives in its own
// column, so switching provider doesn't lose the other key. Because embeddings
// from the two providers aren't comparable, switching provider invalidates the
// shop's existing document_chunks — we delete them and flag the completed files
// for re-upload, rather than let retrieval silently return nothing.
const KEY_COLUMN: Record<AiProvider, "openai_api_key" | "gemini_api_key"> = {
  openai: "openai_api_key",
  gemini: "gemini_api_key",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { ai_provider, api_key, ai_chat_enabled } = body as {
      ai_provider?: unknown;
      api_key?: string | null;
      ai_chat_enabled?: unknown;
    };

    if (ai_chat_enabled !== undefined && typeof ai_chat_enabled !== "boolean") {
      return jsonResponse({ error: "ai_chat_enabled must be a boolean" }, { status: 400 });
    }

    const caller = createCallerClient(req.headers.get("Authorization"));
    const { shopId } = await requireAdmin(caller);
    const service = createServiceClient();

    // Toggle-only call: flip the chatbot on/off without touching the
    // provider/key. Deliberately does NOT require a configured key — a shop can
    // turn the bot off (or back on) regardless of whether it has set one up yet.
    if (ai_provider === undefined) {
      if (typeof ai_chat_enabled !== "boolean") {
        return jsonResponse({ error: "Nothing to update" }, { status: 400 });
      }
      const { error } = await service.from("shops").update({ ai_chat_enabled }).eq("id", shopId);
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ ok: true, ai_chat_enabled });
    }

    if (ai_provider !== "openai" && ai_provider !== "gemini") {
      return jsonResponse({ error: "ai_provider must be 'openai' or 'gemini'" }, { status: 400 });
    }
    if (api_key !== undefined && api_key !== null && typeof api_key !== "string") {
      return jsonResponse(
        { error: "api_key must be a string, null to clear it, or omitted to keep it" },
        { status: 400 }
      );
    }
    const provider = asAiProvider(ai_provider);
    const keyColumn = KEY_COLUMN[provider];
    const { data: shop, error: shopError } = await service
      .from("shops")
      .select("ai_provider, openai_api_key, gemini_api_key")
      .eq("id", shopId)
      .single();
    if (shopError || !shop) {
      return jsonResponse({ error: "Shop not found" }, { status: 404 });
    }

    // Work out the key we'll store for the chosen provider.
    let nextKey: string | null;
    if (api_key === undefined) {
      // Field left blank (the key is write-only in the UI): keep whatever is
      // stored. A provider with no stored key can't be activated.
      nextKey = (shop[keyColumn] as string | null) ?? null;
      if (!nextKey) {
        return jsonResponse(
          { error: `Enter your ${provider === "gemini" ? "Gemini" : "OpenAI"} API key to use this provider.` },
          { status: 400 }
        );
      }
    } else {
      const trimmed = typeof api_key === "string" ? api_key.trim() : null;
      nextKey = trimmed === "" ? null : trimmed;
      // Verify a *new* key before storing it (skip when we kept an existing one
      // above — it was verified when it was first set). This surfaces a bad key
      // or an unpaid account now instead of via a silently dead chatbot later.
      if (nextKey) {
        const check = await checkAiKey(provider, nextKey);
        if (!check.ok) {
          return jsonResponse({ error: check.reason }, { status: 400 });
        }
      }
    }

    const { error: updateError } = await service
      .from("shops")
      .update({
        ai_provider: provider,
        [keyColumn]: nextKey,
        // Fold in a chat toggle if this same save carried one.
        ...(typeof ai_chat_enabled === "boolean" ? { ai_chat_enabled } : {}),
      })
      .eq("id", shopId);
    if (updateError) {
      return jsonResponse({ error: updateError.message }, { status: 500 });
    }

    // Switching provider makes every existing chunk unfindable (embedded with the
    // old provider's model). Wipe them and flag the completed files so the KB
    // page tells the admin to re-upload, instead of a chatbot that quietly finds
    // nothing.
    let reingestRequired = false;
    if (asAiProvider(shop.ai_provider) !== provider) {
      const { count } = await service
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId);
      if ((count ?? 0) > 0) {
        reingestRequired = true;
        await service.from("document_chunks").delete().eq("shop_id", shopId);
        await service
          .from("files")
          .update({
            status: "failed",
            error_message: "AI provider changed — re-upload this document to re-index it for the new provider.",
          })
          .eq("shop_id", shopId)
          .eq("status", "completed");
      }
    }

    // Deliberately does not echo the key back.
    return jsonResponse({ ok: true, provider, configured: nextKey !== null, reingest_required: reingestRequired });
  } catch (error) {
    if (error instanceof AuthzError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
