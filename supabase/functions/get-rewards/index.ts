import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

// Returns the shop's active rewards catalog plus this customer's own
// redemptions (their coupons). Customers have no table-level read access, so
// this runs as service role after proving identity via the signed loyalty
// token — and only ever returns the caller's own redemptions.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token } = body as { qr_token?: string };
    if (!qr_token) {
      return jsonResponse({ error: "qr_token is required" }, { status: 400 });
    }

    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid card token" }, { status: 401 });
    }
    const customerId = payload.cid;
    const shopId = payload.sid;

    const service = createServiceClient();

    const { data: rewards, error: rewardsError } = await service
      .from("rewards")
      .select("id, name, description, points_cost")
      .eq("shop_id", shopId)
      .eq("active", true)
      .order("points_cost", { ascending: true });
    if (rewardsError) {
      return jsonResponse({ error: rewardsError.message }, { status: 500 });
    }

    const { data: redemptions, error: redemptionsError } = await service
      .from("redemptions")
      .select("id, reward_name, points_cost, code, status, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (redemptionsError) {
      return jsonResponse({ error: redemptionsError.message }, { status: 500 });
    }

    return jsonResponse({ rewards: rewards ?? [], redemptions: redemptions ?? [] });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
