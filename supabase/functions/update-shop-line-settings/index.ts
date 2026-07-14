import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";

// RLS only allows super_admin to write `shops` directly (0006_rls_policies.sql),
// so a shop admin's write path for their own LINE credentials/LIFF id is this
// service-role function, which forces the target row to the caller's own shop.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    const admin = await requireAdmin(caller, "Only a shop admin can update LINE settings");

    const body = await req.json();
    const { line_channel_id, line_channel_secret, line_channel_access_token, liff_id } = body as {
      line_channel_id?: string;
      line_channel_secret?: string;
      line_channel_access_token?: string;
      liff_id?: string;
    };

    const service = createServiceClient();
    const { error: updateError } = await service
      .from("shops")
      .update({ line_channel_id, line_channel_secret, line_channel_access_token, liff_id })
      .eq("id", admin.shopId);
    if (updateError) {
      return jsonResponse({ error: updateError.message }, { status: 500 });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
