import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

// Short, human-friendly coupon code (no ambiguous 0/O/1/I/L) so staff can match
// a customer's coupon against the pending-approval list at a glance.
function generateCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token, reward_id } = body as { qr_token?: string; reward_id?: string };
    if (!qr_token || !reward_id) {
      return jsonResponse({ error: "qr_token and reward_id are required" }, { status: 400 });
    }

    // The signed loyalty token is the customer's identity proof — never trust a
    // client-supplied customer_id. The shop is taken from the token too.
    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid card token" }, { status: 401 });
    }
    const customerId = payload.cid;
    const shopId = payload.sid;

    const service = createServiceClient();

    // Same current-card guard every qr_token-authenticated function runs: a
    // valid signature alone doesn't prove the token is still the customer's
    // active card, since these tokens have no expiry.
    const { data: card } = await service
      .from("loyalty_cards")
      .select("qr_token, revoked_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!card || card.revoked_at || card.qr_token !== qr_token) {
      return jsonResponse({ error: "Card not active" }, { status: 401 });
    }

    const { data: reward } = await service
      .from("rewards")
      .select("id, name, points_cost, active, shop_id")
      .eq("id", reward_id)
      .maybeSingle();
    if (!reward || reward.shop_id !== shopId || !reward.active) {
      return jsonResponse({ error: "Reward not available" }, { status: 404 });
    }

    // Soft check only — this is not a reservation. The authoritative balance
    // check happens in complete_redemption when staff approve, so two coupons
    // that together exceed the balance are allowed here and the second simply
    // fails at approval.
    const { data: customer } = await service
      .from("customers")
      .select("points_balance")
      .eq("id", customerId)
      .single();
    if (!customer || customer.points_balance < reward.points_cost) {
      return jsonResponse({ error: "Insufficient points" }, { status: 400 });
    }

    const { data: redemption, error } = await service
      .from("redemptions")
      .insert({
        shop_id: shopId,
        customer_id: customerId,
        reward_id: reward.id,
        reward_name: reward.name,
        points_cost: reward.points_cost,
        code: generateCode(),
        status: "pending",
      })
      .select("id, reward_name, points_cost, code, status, created_at")
      .single();
    if (error || !redemption) {
      return jsonResponse({ error: error?.message ?? "Failed to create redemption" }, { status: 500 });
    }

    return jsonResponse({ redemption });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
