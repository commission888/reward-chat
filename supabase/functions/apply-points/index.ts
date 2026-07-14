import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token, delta, reason } = body as { qr_token?: string; delta?: number; reason?: string };

    if (!qr_token || typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
      return jsonResponse({ error: "qr_token and a non-zero integer delta are required" }, { status: 400 });
    }

    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid or tampered QR token" }, { status: 400 });
    }

    // Pass the staff member's own JWT through (not service role) so
    // apply_points' auth.uid() reflects the real caller and its own
    // role/shop checks stay meaningful — this is defense-in-depth on top of
    // the QR signature check above.
    const caller = createCallerClient(req.headers.get("Authorization"));

    // A valid signature only proves the token was issued by us at some
    // point — it has no expiry (by design, so the card is stable across app
    // opens). Revocation and "regenerate QR" only mean anything if we check
    // the token against the customer's *current* card here: reject anything
    // revoked, and reject any token that isn't the currently-issued one for
    // that customer (an old, superseded token stays validly-signed forever
    // otherwise).
    const { data: card, error: cardError } = await caller
      .from("loyalty_cards")
      .select("qr_token, revoked_at")
      .eq("customer_id", payload.cid)
      .maybeSingle();
    if (cardError || !card) {
      return jsonResponse({ error: "Loyalty card not found" }, { status: 404 });
    }
    if (card.revoked_at) {
      return jsonResponse({ error: "This card has been revoked" }, { status: 400 });
    }
    if (card.qr_token !== qr_token) {
      return jsonResponse(
        { error: "This card is out of date. Ask the customer to reopen the app for their current card." },
        { status: 400 }
      );
    }

    const { data: newBalance, error } = await caller.rpc("apply_points", {
      p_customer_id: payload.cid,
      p_delta: delta,
      p_reason: reason ?? null,
    });
    if (error) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    return jsonResponse({ balance: newBalance });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
