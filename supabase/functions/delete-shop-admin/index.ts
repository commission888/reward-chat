import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireSuperAdmin } from "../_shared/requireAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    await requireSuperAdmin(caller, "Only the platform super admin can delete shop admins");

    const body = await req.json();
    const { user_id } = body as { user_id?: string };
    if (!user_id) {
      return jsonResponse({ error: "user_id is required" }, { status: 400 });
    }

    const service = createServiceClient();

    // Only a shop 'admin' can be removed here — this keeps the endpoint from
    // being used to delete the super_admin itself or a staff account (staff
    // are managed per-shop by their own admin, not here).
    const { data: target, error: targetError } = await service
      .from("profiles")
      .select("id, role")
      .eq("id", user_id)
      .single();
    if (targetError || !target) {
      return jsonResponse({ error: "Admin not found" }, { status: 404 });
    }
    if (target.role !== "admin") {
      return jsonResponse({ error: "This account is not a shop admin" }, { status: 403 });
    }

    // Deleting the auth user cascades the profiles row away via
    // `profiles.id -> auth.users on delete cascade`.
    const { error: deleteError } = await service.auth.admin.deleteUser(user_id);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, { status: 500 });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
