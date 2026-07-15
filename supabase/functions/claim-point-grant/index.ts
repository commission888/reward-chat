import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;

// The customer claiming has no Supabase JWT, so their identity is the signed
// loyalty token — same contract as create-redemption/get-rewards. Note the two
// tokens here do different jobs: `qr_token` says *who* is claiming, `grant`
// says *what* is being claimed.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { qr_token, grant } = body as { qr_token?: string; grant?: string };
    if (!qr_token || !grant) {
      return jsonResponse({ error: "qr_token and grant are required" }, { status: 400 });
    }

    let payload;
    try {
      payload = await verifyQrToken(qr_token, QR_SIGNING_SECRET);
    } catch {
      return jsonResponse({ error: "Invalid card token" }, { status: 401 });
    }

    const service = createServiceClient();

    // Same current-card guard as create-redemption: a valid signature alone
    // doesn't prove this is still the customer's active card.
    const { data: card } = await service
      .from("loyalty_cards")
      .select("qr_token, revoked_at")
      .eq("customer_id", payload.cid)
      .maybeSingle();
    if (!card || card.revoked_at || card.qr_token !== qr_token) {
      return jsonResponse({ error: "Card not active" }, { status: 401 });
    }

    // Every real check — single-use, expiry, shop match — lives inside the RPC,
    // where the row lock makes them atomic. Doing any of it out here would open
    // the exact race the lock exists to close.
    const { data, error } = await service.rpc("claim_point_grant", {
      p_token: grant,
      p_customer_id: payload.cid,
    });
    if (error) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    const result = Array.isArray(data) ? data[0] : data;
    return jsonResponse({ points: result?.points ?? 0, balance: result?.balance ?? 0 });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
