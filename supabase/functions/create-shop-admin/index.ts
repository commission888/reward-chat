import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireSuperAdmin } from "../_shared/requireAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    await requireSuperAdmin(caller, "Only the platform super admin can create shop admins");

    const body = await req.json();
    const { shop_id, full_name, email, password } = body as {
      shop_id?: string;
      full_name?: string;
      email?: string;
      password?: string;
    };

    if (!shop_id || !full_name || !email || !password) {
      return jsonResponse({ error: "shop_id, full_name, email, and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return jsonResponse({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const service = createServiceClient();

    // Validate the target shop exists *before* createUser: the
    // handle_new_auth_user trigger inserts a profiles row referencing this
    // shop_id, and a bad id would fail that insert on the FK, leaving the
    // caller reasoning about a half-created auth user. Cheap check up front.
    const { data: shop, error: shopError } = await service.from("shops").select("id").eq("id", shop_id).single();
    if (shopError || !shop) {
      return jsonResponse({ error: "Shop not found" }, { status: 404 });
    }

    // role is hardcoded 'admin' server-side — never taken from the body, or a
    // caller could mint a super_admin. shop_id is the (validated) target shop.
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "admin",
        shop_id,
        full_name,
      },
    });
    if (createError) {
      return jsonResponse({ error: createError.message }, { status: 400 });
    }

    return jsonResponse({ id: created.user?.id });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
