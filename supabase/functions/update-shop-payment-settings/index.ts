import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabaseClients.ts";
import { AuthzError, requireAdmin } from "../_shared/requireAdmin.ts";

// Same pattern as update-shop-line-settings: RLS only allows super_admin to
// write `shops` directly, so this service-role function is the admin's write
// path for their own Slip2Go credentials, forcing the target row to the
// caller's own shop.
//
// `slip_receivers` is the list of accounts a slip may be paid to (see 0020) —
// stored as a jsonb array so a shop can accept several accounts, including
// KShop/merchant accounts (account_type "03000"). checkReceiver in Slip2Go
// matches if ANY entry matches, so any listed account credits.
type SlipReceiverInput = {
  account_type?: unknown;
  account_number?: unknown;
  account_name_th?: unknown;
  account_name_en?: unknown;
};

type SlipReceiver = {
  account_type: string;
  account_number: string;
  account_name_th?: string;
  account_name_en?: string;
};

// Keep only rows the customer actually filled in, and require the two fields the
// match depends on. A row with a type but no number (or vice versa) is a
// half-entered mistake, not an intentional blank, so reject it rather than store
// something Slip2Go can never match.
function normalizeReceivers(raw: unknown): SlipReceiver[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("slip_receivers must be an array");

  const cleaned: SlipReceiver[] = [];
  for (const item of raw as SlipReceiverInput[]) {
    const type = typeof item?.account_type === "string" ? item.account_type.trim() : "";
    const number = typeof item?.account_number === "string" ? item.account_number.trim() : "";
    const nameTh = typeof item?.account_name_th === "string" ? item.account_name_th.trim() : "";
    const nameEn = typeof item?.account_name_en === "string" ? item.account_name_en.trim() : "";

    // Fully empty row (e.g. an "add" the user never filled): drop silently.
    if (!type && !number && !nameTh && !nameEn) continue;
    if (!type || !number) throw new Error("Each receiver needs both an account type and an account number");

    const receiver: SlipReceiver = { account_type: type, account_number: number };
    if (nameTh) receiver.account_name_th = nameTh;
    if (nameEn) receiver.account_name_en = nameEn;
    cleaned.push(receiver);
  }
  return cleaned;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = createCallerClient(req.headers.get("Authorization"));
    const admin = await requireAdmin(caller, "Only a shop admin can update payment settings");

    const body = await req.json();
    const { slip2go_api_secret, slip_receivers } = body as {
      slip2go_api_secret?: string;
      slip_receivers?: unknown;
    };

    let receivers: SlipReceiver[];
    try {
      receivers = normalizeReceivers(slip_receivers);
    } catch (validationError) {
      return jsonResponse(
        { error: validationError instanceof Error ? validationError.message : "Invalid slip_receivers" },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const { error: updateError } = await service
      .from("shops")
      .update({
        slip2go_api_secret,
        slip_receivers: receivers,
      })
      .eq("id", admin.shopId);
    if (updateError) {
      return jsonResponse({ error: updateError.message }, { status: 500 });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof AuthzError) return jsonResponse({ error: error.message }, { status: error.status });
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
});
