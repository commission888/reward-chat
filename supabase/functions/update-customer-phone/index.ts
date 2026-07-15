import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

// LINE Login never exposes a phone number — there's no scope for it — so the
// only way this column gets filled is the customer typing it themselves. They
// have no Supabase JWT, so identity is the signed loyalty token, exactly as in
// create-redemption/get-rewards.
const MAX_PHONE_LENGTH = 20;

// Keep digits and a leading +; drop the spaces, dashes and parentheses people
// type. Deliberately not validating the shape beyond that: Thai numbers get
// written 08x-xxx-xxxx, +66 8x xxx xxxx and several other ways, and rejecting a
// real number is worse than storing an odd-looking one.
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^0-9]/g, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token, phone } = body as { qr_token?: string; phone?: string };
    if (!qr_token || typeof phone !== "string") {
      return jsonResponse({ error: "qr_token and phone are required" }, { status: 400 });
    }

    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid card token" }, { status: 401 });
    }

    const normalized = normalizePhone(phone);
    if (normalized.length > MAX_PHONE_LENGTH) {
      return jsonResponse({ error: "Phone number is too long" }, { status: 400 });
    }
    // An empty string is how the customer clears a number they'd rather not share.
    const nextPhone = normalized === "" || normalized === "+" ? null : normalized;

    const service = createServiceClient();

    // Same current-card guard as create-redemption.
    const { data: card } = await service
      .from("loyalty_cards")
      .select("qr_token, revoked_at")
      .eq("customer_id", payload.cid)
      .maybeSingle();
    if (!card || card.revoked_at || card.qr_token !== qr_token) {
      return jsonResponse({ error: "Card not active" }, { status: 401 });
    }

    const { data: customer, error } = await service
      .from("customers")
      .update({ phone: nextPhone })
      .eq("id", payload.cid)
      .select("id, display_name, picture_url, phone, points_balance")
      .single();
    if (error || !customer) {
      return jsonResponse({ error: error?.message ?? "Failed to save phone" }, { status: 500 });
    }

    return jsonResponse({ customer });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
