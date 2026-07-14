// Slip2Go payment-slip verification (https://slip2go.com/guide/rest-api/image).
// Docs confirmed: POST multipart/form-data to /api/verify-slip/qr-image/info,
// `Authorization: Bearer <secret>`, field `file` is the slip image, optional
// `payload` (JSON, as a form field) carries checkReceiver/checkDuplicate.

// Overridable only for pointing tests at a local mock server — never set
// SLIP2GO_BASE_URL in a real deployment.
const SLIP2GO_BASE_URL = Deno.env.get("SLIP2GO_BASE_URL") ?? "https://api.slip2go.com";

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

// A human-readable Thai reply for the customer, derived from Slip2Go's code.
// See https://slip2go.com/guide/response for the full code reference.
export function describeSlip2GoCode(code: string): string {
  switch (code) {
    case "200000":
      return "ตรวจสอบสลิปสำเร็จ";
    case "200401":
      return "บัญชีผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า";
    case "200402":
      return "ยอดเงินในสลิปไม่ตรงกับที่คาดไว้";
    case "200403":
      return "วันที่โอนในสลิปไม่ตรงกับที่คาดไว้";
    case "200404":
      return "ไม่พบรายการนี้ในระบบธนาคาร กรุณาตรวจสอบสลิปอีกครั้ง";
    case "200500":
      return "สลิปนี้อาจถูกปลอมแปลงหรือเสียหาย";
    case "200501":
      return "สลิปนี้เคยถูกใช้ไปแล้ว";
    case "200502":
      return "ระบบธนาคารขัดข้อง กรุณาลองใหม่อีกครั้ง";
    default:
      return "ไม่สามารถตรวจสอบสลิปนี้ได้ กรุณาส่งรูปสลิปที่ชัดเจน";
  }
}
