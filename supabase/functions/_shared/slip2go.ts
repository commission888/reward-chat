// Slip2Go payment-slip verification (https://slip2go.com/guide/rest-api/image).
// Docs confirmed: POST multipart/form-data to /api/verify-slip/qr-image/info,
// `Authorization: Bearer <secret>`, field `file` is the slip image, optional
// `payload` (JSON, as a form field) carries checkReceiver/checkDuplicate.

import { resolveReplyTemplate, type ReplyTemplates } from "./replyTemplates.ts";

// Overridable only for pointing tests at a local mock server — never set
// SLIP2GO_BASE_URL in a real deployment.
const SLIP2GO_BASE_URL = Deno.env.get("SLIP2GO_BASE_URL") ?? "https://connect.slip2go.com";

export type Slip2GoCheckReceiver = {
  accountType: string;
  accountNameTH?: string;
  accountNameEN?: string;
  accountNumber?: string;
};

export type Slip2GoResponse = {
  code: string;
  message: string;
  data?: {
    referenceId?: string;
    transRef?: string;
    dateTime?: string;
    amount?: number;
    receiver?: {
      account?: { name?: string; bank?: { account?: string | null } };
      bank?: { id?: string; name?: string | null };
    };
    sender?: {
      account?: { name?: string; bank?: { account?: string } };
      bank?: { id?: string; name?: string | null };
    };
  };
};

export async function verifySlipImage(
  imageBytes: Uint8Array,
  apiSecret: string,
  options?: { checkReceiver?: Slip2GoCheckReceiver[]; checkDuplicate?: boolean }
): Promise<Slip2GoResponse> {
  const form = new FormData();
  form.append("file", new Blob([imageBytes], { type: "image/jpeg" }), "slip.jpg");
  if (options && (options.checkReceiver || options.checkDuplicate !== undefined)) {
    form.append(
      "payload",
      JSON.stringify({
        ...(options.checkReceiver ? { checkReceiver: options.checkReceiver } : {}),
        ...(options.checkDuplicate !== undefined ? { checkDuplicate: options.checkDuplicate } : {}),
      })
    );
  }

  const res = await fetch(`${SLIP2GO_BASE_URL}/api/verify-slip/qr-image/info`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiSecret}` },
    body: form,
  });

  const json = (await res.json()) as Slip2GoResponse;
  return json;
}

// A human-readable reply for the customer, derived from Slip2Go's code.
// See https://slip2go.com/guide/response for the full code reference.
//
// The wording is a per-shop setting (/settings/ai): every branch below resolves
// through the shop's `reply_templates`, falling back to the system default when
// the shop hasn't rewritten that sentence. Pass the shop's templates in; `{}` or
// null gives you the stock Thai wording this function used to hardcode.
//
// There's no `200000` branch: its only caller reaches this function exclusively
// on codes *outside* SLIP_SUCCESS_CODES (which holds 200000 and 200200), so the
// "ตรวจสอบสลิปสำเร็จ" string this used to carry was unreachable — a verified slip
// gets the Flex receipt instead. Leaving it in would have put a dead field on the
// settings page that no customer could ever be shown.
export function describeSlip2GoCode(code: string, templates?: ReplyTemplates | null): string {
  switch (code) {
    case "200401":
      return resolveReplyTemplate(templates, "slip.receiver_mismatch");
    case "200402":
      return resolveReplyTemplate(templates, "slip.amount_mismatch");
    case "200403":
      return resolveReplyTemplate(templates, "slip.date_mismatch");
    case "200404":
      return resolveReplyTemplate(templates, "slip.not_found");
    case "200500":
      return resolveReplyTemplate(templates, "slip.forged");
    case "200501":
      return resolveReplyTemplate(templates, "slip.duplicate");
    case "200502":
      return resolveReplyTemplate(templates, "slip.bank_error");
    default:
      return resolveReplyTemplate(templates, "slip.unknown");
  }
}
