import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    const admin = await requireAdmin(caller, "Only a shop admin can create staff accounts");

    const body = await req.json();
    const { full_name, email, password, role } = body as {
      full_name?: string;
      email?: string;
      password?: string;
      role?: string;
    };

    if (!full_name || !email || !password || !["admin", "staff"].includes(role ?? "")) {
      return jsonResponse({ error: "full_name, email, password, and role (admin|staff) are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return jsonResponse({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const service = createServiceClient();
    // shop_id is always forced to the caller's own shop — never trust a
    // client-supplied shop_id here, or an admin could provision staff into a
    // shop they don't own.
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role,
        shop_id: admin.shopId,
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
