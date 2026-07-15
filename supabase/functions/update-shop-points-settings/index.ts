import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";

// `shops.points_config` is locked down like the rest of `shops` (only
// super_admin can write the table directly), so this is the sanctioned path for
// a shop admin to edit their own points rules.
const MAX_THRESHOLD = 100_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { redeem_threshold } = body as { redeem_threshold?: number | null };

    if (
      redeem_threshold !== null &&
      (typeof redeem_threshold !== "number" ||
        !Number.isInteger(redeem_threshold) ||
        redeem_threshold < 0 ||
        redeem_threshold > MAX_THRESHOLD)
    ) {
      return jsonResponse(
        { error: `redeem_threshold must be a whole number from 0 to ${MAX_THRESHOLD}, or null` },
        { status: 400 }
      );
    }

    const caller = createCallerClient(req.headers.get("Authorization"));
    const { shopId } = await requireAdmin(caller);

    const service = createServiceClient();

    // points_config is a shared jsonb bag — it also holds points_per_baht and
    // points_per_slip, which drive slip crediting. Writing a fresh object here
    // would wipe those and silently stop slips earning anything, so read the
    // current value and merge into it.
    const { data: shop, error: readError } = await service
      .from("shops")
      .select("points_config")
      .eq("id", shopId)
      .single();
    if (readError || !shop) {
      return jsonResponse({ error: readError?.message ?? "Shop not found" }, { status: 404 });
    }

    const next = { ...(shop.points_config ?? {}) } as Record<string, unknown>;
    if (redeem_threshold === null) {
      delete next.redeem_threshold;
    } else {
      next.redeem_threshold = redeem_threshold;
    }

    const { data: updated, error } = await service
      .from("shops")
      .update({ points_config: next })
      .eq("id", shopId)
      .select("points_config")
      .single();
    if (error || !updated) {
      return jsonResponse({ error: error?.message ?? "Failed to save" }, { status: 500 });
    }

    return jsonResponse({ points_config: updated.points_config });
  } catch (error) {
    if (error instanceof AuthzError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
