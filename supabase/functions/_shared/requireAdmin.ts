import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Thrown by requireAdmin; callers catch this specifically and translate it
// to the right HTTP status, keeping each function's own try/catch generic.
export class AuthzError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Shared "caller must be an admin of their own shop" gate, used by every
// admin-only edge function. Previously each function re-implemented this
// check independently — a fix applied to one copy and missed in another
// would silently leave a privilege-check gap in exactly the unfixed
// function, so this is the single place that logic lives now.
export async function requireAdmin(
  caller: SupabaseClient,
  message = "Only a shop admin can perform this action"
): Promise<{ userId: string; shopId: string }> {
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) throw new AuthzError("Not authenticated", 401);

  const { data: profile, error } = await caller.from("profiles").select("role, shop_id").eq("id", user.id).single();
  if (error || !profile || profile.role !== "admin" || !profile.shop_id) {
    throw new AuthzError(message, 403);
  }
  return { userId: user.id, shopId: profile.shop_id };
}

// Shared "caller works at some shop" gate — admin *or* staff. Used by functions
// serving the counter (scanning a card), where staff are the primary users and
// requireAdmin would lock them out. Returns the caller's own shop_id, which the
// function must compare against whatever tenant the request targets.
export async function requireShopMember(
  caller: SupabaseClient,
  message = "Only shop staff can perform this action"
): Promise<{ userId: string; shopId: string; role: string }> {
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) throw new AuthzError("Not authenticated", 401);

  const { data: profile, error } = await caller.from("profiles").select("role, shop_id").eq("id", user.id).single();
  if (error || !profile || !profile.shop_id || (profile.role !== "admin" && profile.role !== "staff")) {
    throw new AuthzError(message, 403);
  }
  return { userId: user.id, shopId: profile.shop_id, role: profile.role };
}

// Shared "caller must be the platform super_admin" gate, used by cross-tenant
// admin functions (create a shop's admin, delete a shop). Unlike requireAdmin,
// there's no shop_id to return — a super_admin isn't scoped to one shop, so the
// target shop is supplied and validated by the calling function instead.
export async function requireSuperAdmin(
  caller: SupabaseClient,
  message = "Only the platform super admin can perform this action"
): Promise<{ userId: string }> {
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) throw new AuthzError("Not authenticated", 401);

  const { data: profile, error } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (error || !profile || profile.role !== "super_admin") {
    throw new AuthzError(message, 403);
  }
  return { userId: user.id };
}
