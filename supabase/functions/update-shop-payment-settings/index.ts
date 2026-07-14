import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";

// Same pattern as update-shop-line-settings: RLS only allows super_admin to
// write `shops` directly, so this service-role function is the admin's write
// path for their own Slip2Go credentials, forcing the target row to the
// caller's own shop.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    const admin = await requireAdmin(caller, "Only a shop admin can update payment settings");

    const body = await req.json();
    const {
      slip2go_api_secret,
      slip_receiver_account_type,
      slip_receiver_account_name_th,
      slip_receiver_account_name_en,
      slip_receiver_account_number,
    } = body as {
      slip2go_api_secret?: string;
      slip_receiver_account_type?: string;
      slip_receiver_account_name_th?: string;
      slip_receiver_account_name_en?: string;
      slip_receiver_account_number?: string;
    };

    const service = createServiceClient();
    const { error: updateError } = await service
      .from("shops")
      .update({
        slip2go_api_secret,
        slip_receiver_account_type,
        slip_receiver_account_name_th,
        slip_receiver_account_name_en,
        slip_receiver_account_number,
      })
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
