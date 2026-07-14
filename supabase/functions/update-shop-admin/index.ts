import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireSuperAdmin } from "../_shared/requireAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    await requireSuperAdmin(caller, "Only the platform super admin can edit shop admins");

    const body = await req.json();
    const { user_id, full_name, email, password } = body as {
      user_id?: string;
      full_name?: string;
      email?: string;
      password?: string;
    };

    if (!user_id) {
      return jsonResponse({ error: "user_id is required" }, { status: 400 });
    }
    // password is optional on edit; only validate when actually changing it.
    // The frontend omits the key entirely for an email/name-only edit, so a
    // legitimate "change the email, leave the password" request isn't rejected.
    if (password !== undefined && password.length < 8) {
      return jsonResponse({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const service = createServiceClient();

    // Only shop admins may be edited here — never the super_admin or a staff
    // row. We've already confirmed the caller is super_admin, so reading the
    // target with the service client is fine; the role guard is what stops
    // this endpoint being turned against the platform account or staff.
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

    // email/password live in auth.users, so they go through the Auth admin API.
    // email_confirm skips the confirmation round-trip (an admin-set email is
    // trusted). full_name is mirrored into user_metadata for display parity;
    // role/shop_id authz is read from profiles, never from user_metadata.
    const authUpdate: {
      email?: string;
      password?: string;
      email_confirm?: boolean;
      user_metadata?: Record<string, unknown>;
    } = {};
    if (email !== undefined) {
      authUpdate.email = email;
      authUpdate.email_confirm = true;
    }
    if (password !== undefined) authUpdate.password = password;
    if (full_name !== undefined) authUpdate.user_metadata = { full_name };

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await service.auth.admin.updateUserById(user_id, authUpdate);
      if (authError) {
        return jsonResponse({ error: authError.message }, { status: 400 });
      }
    }

    // profiles.email / profiles.full_name are what the merchant UI reads; they
    // aren't kept in sync from auth.users automatically, so mirror them here.
    const profileUpdate: { email?: string; full_name?: string } = {};
    if (email !== undefined) profileUpdate.email = email;
    if (full_name !== undefined) profileUpdate.full_name = full_name;
    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await service.from("profiles").update(profileUpdate).eq("id", user_id);
      if (profileError) {
        return jsonResponse({ error: profileError.message }, { status: 500 });
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
