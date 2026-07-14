import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireSuperAdmin } from "../_shared/requireAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    await requireSuperAdmin(caller, "Only the platform super admin can delete shops");

    const body = await req.json();
    const { shop_id } = body as { shop_id?: string };
    if (!shop_id) {
      return jsonResponse({ error: "shop_id is required" }, { status: 400 });
    }

    const service = createServiceClient();

    const { data: shop, error: shopError } = await service.from("shops").select("id").eq("id", shop_id).single();
    if (shopError || !shop) {
      return jsonResponse({ error: "Shop not found" }, { status: 404 });
    }

    // Order matters. profiles.shop_id is `on delete set null`, but the
    // profiles_shop_role_check constraint forbids a null shop_id for
    // admin/staff — so deleting the shop first would fail on any member the
    // shop has. Instead delete the shop's auth.users first: profiles cascade
    // away via `profiles.id -> auth.users on delete cascade`. THEN delete the
    // shop, which cascades customers/loyalty_cards/points_transactions/files/
    // document_chunks/slip_verifications (all `on delete cascade`).
    const { data: members, error: membersError } = await service
      .from("profiles")
      .select("id")
      .eq("shop_id", shop_id);
    if (membersError) {
      return jsonResponse({ error: membersError.message }, { status: 500 });
    }

    for (const member of members ?? []) {
      const { error: deleteUserError } = await service.auth.admin.deleteUser(member.id);
      if (deleteUserError) {
        return jsonResponse({ error: `Failed to delete member: ${deleteUserError.message}` }, { status: 500 });
      }
    }

    const { error: deleteShopError } = await service.from("shops").delete().eq("id", shop_id);
    if (deleteShopError) {
      return jsonResponse({ error: deleteShopError.message }, { status: 500 });
    }

    // NOTE: this cascades every table row, but knowledge-files storage objects
    // under this shop's folder are NOT cleaned up here and are left orphaned.
    // Acceptable for now; revisit if shop deletion becomes a common operation.
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
