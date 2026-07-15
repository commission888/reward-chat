import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";
import { checkApiKey } from "../_shared/openai.ts";

// `shops` is only writable by super_admin under RLS, so this is the sanctioned
// path for a shop admin to set their own OpenAI key.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { openai_api_key } = body as { openai_api_key?: string | null };

    if (openai_api_key !== null && typeof openai_api_key !== "string") {
      return jsonResponse({ error: "openai_api_key must be a string, or null to clear it" }, { status: 400 });
    }

    const caller = createCallerClient(req.headers.get("Authorization"));
    const { shopId } = await requireAdmin(caller);

    const trimmed = typeof openai_api_key === "string" ? openai_api_key.trim() : null;
    const nextKey = trimmed === "" ? null : trimmed;

    // Verify before storing. The failure mode this guards against is a shop
    // pasting a typo'd or expired key and finding out days later via a chatbot
    // that quietly answers nothing — the whole point of a mandatory key is lost
    // if a broken one saves silently.
    if (nextKey) {
      const check = await checkApiKey(nextKey);
      if (!check.ok) {
        return jsonResponse({ error: check.reason }, { status: 400 });
      }
    }

    const service = createServiceClient();
    const { error } = await service.from("shops").update({ openai_api_key: nextKey }).eq("id", shopId);
    if (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }

    // Deliberately does not echo the key back.
    return jsonResponse({ ok: true, configured: nextKey !== null });
  } catch (error) {
    if (error instanceof AuthzError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
