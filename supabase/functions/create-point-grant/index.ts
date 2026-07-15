import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireShopMember } from "../_shared/requireAdmin.ts";

// A grant is worthless once claimed, but until then anyone who photographs the
// QR off the counter screen holds it. Five minutes is long enough to hand a
// phone over and short enough that a photo taken over someone's shoulder is
// almost always dead by the time it's used.
const TTL_MINUTES = 5;
const MIN_POINTS = 1;
const MAX_POINTS = 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { points } = body as { points?: number };

    if (typeof points !== "number" || !Number.isInteger(points) || points < MIN_POINTS || points > MAX_POINTS) {
      return jsonResponse({ error: `points must be a whole number from ${MIN_POINTS} to ${MAX_POINTS}` }, { status: 400 });
    }

    // Staff are the primary users of this page, so admin-or-staff — and the
    // shop is taken from the caller's own profile, never from the body.
    const caller = createCallerClient(req.headers.get("Authorization"));
    const { userId, shopId } = await requireShopMember(caller);

    const service = createServiceClient();

    const { data: shop } = await service.from("shops").select("liff_id").eq("id", shopId).single();
    if (!shop?.liff_id) {
      // Without a LIFF id there's nowhere for the QR to point, and a QR built
      // against an empty id would just fail in the customer's hands instead.
      return jsonResponse({ error: "Set up your LINE settings first — this shop has no LIFF app yet." }, { status: 400 });
    }

    // Holding this token is what claims the points, so it's a secret: 122 bits
    // of randomness, not a short human-readable code someone could guess inside
    // the five-minute window.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

    const { data: grant, error } = await service
      .from("point_grants")
      .insert({ shop_id: shopId, staff_user_id: userId, points, token, expires_at: expiresAt })
      .select("id, points, token, expires_at")
      .single();
    if (error || !grant) {
      return jsonResponse({ error: error?.message ?? "Failed to create grant" }, { status: 500 });
    }

    // The customer opens this with LINE's scanner or their plain camera app; a
    // liff.line.me link hands off to the LINE app either way.
    const url = `https://liff.line.me/${shop.liff_id}?grant=${encodeURIComponent(token)}`;

    return jsonResponse({ grant: { points: grant.points, expires_at: grant.expires_at, url } });
  } catch (error) {
    if (error instanceof AuthzError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
