import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabaseClients.ts";
import { verifyLiffIdToken } from "../_shared/line.ts";
import { signQrToken } from "../_shared/jwt-qr.ts";

const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET")!;
// Local-dev-only escape hatch: real LINE LIFF requires HTTPS + a live LIFF
// app, so during local iteration the frontend can set VITE_LIFF_MOCK=true
// and send a fake id_token; this function accepts a matching dev bypass
// token instead of calling LINE's verify endpoint.
//
// NEVER run `supabase secrets set REGISTER_CUSTOMER_DEV_BYPASS_TOKEN=...`
// against a linked (non-local) project — while set, anyone who knows the
// token value can register/impersonate any customer for any shop with zero
// LINE verification. The loud warning below is deliberate: this should be
// impossible to miss in function logs if it's ever active outside local dev.
const DEV_BYPASS_TOKEN = Deno.env.get("REGISTER_CUSTOMER_DEV_BYPASS_TOKEN");
if (DEV_BYPASS_TOKEN) {
  console.warn(
    "[register-customer] REGISTER_CUSTOMER_DEV_BYPASS_TOKEN is set — LINE id_token verification can be bypassed. " +
      "This must only ever be set for local development."
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { shop_id, id_token, dev_line_user_id, dev_display_name } = body as {
      shop_id?: string;
      id_token?: string;
      dev_line_user_id?: string;
      dev_display_name?: string;
    };

    if (!shop_id || !id_token) {
      return jsonResponse({ error: "shop_id and id_token are required" }, { status: 400 });
    }

    const service = createServiceClient();
    const { data: shop, error: shopError } = await service
      .from("shops")
      .select("id, name, liff_id")
      .eq("id", shop_id)
      .single();
    if (shopError || !shop) {
      return jsonResponse({ error: "Unknown shop" }, { status: 404 });
    }

    let lineUserId: string;
    let displayName: string | null = null;
    let pictureUrl: string | null = null;

    if (DEV_BYPASS_TOKEN && id_token === DEV_BYPASS_TOKEN) {
      console.warn(`[register-customer] DEV BYPASS used for shop ${shop_id} — LINE identity was NOT verified.`);
      lineUserId = dev_line_user_id ?? `dev-${crypto.randomUUID()}`;
      displayName = dev_display_name ?? "Dev Customer";
    } else {
      // Trust boundary: only a LINE-signed id_token proves this request came
      // from the LINE user it claims to be. Never trust a raw userId posted
      // by the client, or one customer could view/spoof another's card.
      //
      // LINE's /oauth2/v2.1/verify wants the LINE Login *Channel ID* as
      // client_id (it must match the id_token's `aud`), which is the numeric
      // prefix of the LIFF ID — e.g. LIFF ID "2010706123-N4ACFeDJ" belongs to
      // channel "2010706123". `shop.liff_id` stores the full LIFF ID (the
      // frontend needs it for liff.init), so strip the suffix here.
      const liffChannelId = (shop.liff_id ?? "").split("-")[0];
      const verified = await verifyLiffIdToken(id_token, liffChannelId);
      lineUserId = verified.sub;
      displayName = verified.name ?? null;
      pictureUrl = verified.picture ?? null;
    }

    const { data: customer, error: upsertError } = await service
      .from("customers")
      .upsert(
        { shop_id, line_user_id: lineUserId, display_name: displayName, picture_url: pictureUrl },
        { onConflict: "shop_id,line_user_id", ignoreDuplicates: false }
      )
      .select("id, shop_id, display_name, picture_url, points_balance")
      .single();
    if (upsertError || !customer) {
      return jsonResponse({ error: upsertError?.message ?? "Failed to register customer" }, { status: 500 });
    }

    const { data: existingCard } = await service
      .from("loyalty_cards")
      .select("qr_token")
      .eq("customer_id", customer.id)
      .is("revoked_at", null)
      .maybeSingle();

    let qrToken = existingCard?.qr_token;
    if (!qrToken) {
      qrToken = await signQrToken({ cid: customer.id, sid: shop_id }, QR_SIGNING_SECRET);
      const { error: cardError } = await service
        .from("loyalty_cards")
        .insert({ customer_id: customer.id, shop_id, qr_token: qrToken });
      if (cardError) {
        // Two near-simultaneous registrations (e.g. React StrictMode's double
        // effect in dev, or a double-tap) can both pass the "no existing
        // card" check above and race on the insert. Postgres' unique
        // constraint on customer_id is the real guard; on a 23505 conflict,
        // the other request won — fetch its qr_token instead of erroring,
        // so the card stays stable rather than surfacing a spurious failure.
        if (cardError.code === "23505") {
          const { data: winningCard, error: refetchError } = await service
            .from("loyalty_cards")
            .select("qr_token")
            .eq("customer_id", customer.id)
            .single();
          if (refetchError || !winningCard) {
            return jsonResponse({ error: refetchError?.message ?? "Failed to load loyalty card" }, { status: 500 });
          }
          qrToken = winningCard.qr_token;
        } else {
          return jsonResponse({ error: cardError.message }, { status: 500 });
        }
      }
    }

    return jsonResponse({ customer, qr_token: qrToken, shop: { id: shop.id, name: shop.name } });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
