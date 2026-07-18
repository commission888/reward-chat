import jsQR from "jsqr";

// Reads a shop's Thai QR Payment merchant standee QR and pulls out the receiver
// identity Slip2Go matches on. A merchant QR carries no bank account number — the
// value that matches (Slip2Go accountType "03000") is the Merchant ID, which the
// EMVCo payload stores inside its merchant account-info templates (tags 30/31).
// Two shapes are handled, both confirmed against live CNX Haircutz standees:
//   - KShop (KBANK): Merchant ID is "KB" + digits, e.g. "KB000001915048".
//   - แม่มณี Mae Manee (SCB) and other merchant QRs: a numeric Merchant ID,
//     e.g. "014000008431058", printed on the standee as "รหัสร้านค้า".

export type ParsedQrReceiver = {
  account_type: string;
  account_number: string;
  account_name_en: string;
};

// Draw the uploaded image onto a canvas and read the QR with jsQR (pure JS, so
// it works in every browser — no native BarcodeDetector dependency). Returns the
// raw EMVCo payload string, or null if no QR could be found in the image.
//
// jsQR silently fails on large images — a full-res phone photo of a KShop
// standee (≈1900×2900) reads as "no QR", while the very same picture scaled down
// decodes cleanly (error correction rides over the centre logo). So we don't
// feed it the original: we try a few capped longest-side widths, smaller ones
// too since a QR that fills only part of the frame needs more shrinking, and
// stop at the first that decodes.
const QR_DECODE_WIDTHS = [1000, 800, 600, 500];

export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Never upscale (min with 1); skip a target that lands on a size already
    // tried, so a small original is decoded once and a large one steps down
    // through the distinct smaller sizes.
    const tried = new Set<number>();
    for (const target of QR_DECODE_WIDTHS) {
      const scale = Math.min(1, target / longest);
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      if (tried.has(w)) continue;
      tried.add(w);
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const found = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

type Tlv = { tag: string; value: string };

// EMVCo QR is length-prefixed TLV: 2-char tag, 2-digit length, then the value.
// Stops cleanly on any malformed trailer rather than throwing, since a photo of a
// QR can decode with stray characters.
function parseTlv(s: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number.parseInt(s.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length < len) break;
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

// KShop Merchant IDs are "KB" + digits (e.g. KB000001915048). Other merchant QRs
// (แม่มณี etc.) use a purely numeric Merchant ID (e.g. 014000008431058).
const KSHOP_MERCHANT_ID_RE = /^KB\d{6,}$/;
const NUMERIC_MERCHANT_ID_RE = /^\d{10,}$/;

// Thai QR domestic-merchant AID prefix. Both KShop (…010112/…010113) and Mae
// Manee (…010112) carry it in their merchant credit-transfer templates. Personal
// PromptPay (tag 29) shares the prefix, but we never read tag 29 — so a personal
// QR's national ID can never be mistaken for a merchant ID.
const THAI_QR_MERCHANT_AID = "A000000677";

// Merchant account-information templates live in tags 26–51; the merchant name is
// tag 59. Two extraction paths, KShop preferred:
//   - KShop: scan every sub-field of tags 26–51 for a "KB…" Merchant ID rather
//     than hard-coding a sub-tag, so a small layout change doesn't break it.
//   - Numeric (แม่มณี etc.): read sub-tag 02 of a merchant template (tags 30/31)
//     specifically — it must be named, since sub-01 (the acquirer/biller ID) is
//     the same length and can't be told apart by shape.
export function extractKShopReceiver(payload: string): ParsedQrReceiver | null {
  const top = parseTlv(payload);
  let nameEn = "";
  let kshopId: string | null = null;
  let numericId: string | null = null;

  for (const t of top) {
    if (t.tag === "59") nameEn = t.value.trim();
    if (t.tag >= "26" && t.tag <= "51") {
      for (const sub of parseTlv(t.value)) {
        const v = sub.value.trim();
        if (!kshopId && KSHOP_MERCHANT_ID_RE.test(v)) kshopId = v;
      }
    }
    if ((t.tag === "30" || t.tag === "31") && !numericId) {
      const subs = parseTlv(t.value);
      const guid = subs.find((s) => s.tag === "00")?.value.trim() ?? "";
      const id = subs.find((s) => s.tag === "02")?.value.trim() ?? "";
      if (guid.startsWith(THAI_QR_MERCHANT_AID) && NUMERIC_MERCHANT_ID_RE.test(id)) {
        numericId = id;
      }
    }
  }

  const merchantId = kshopId ?? numericId;
  if (!merchantId) return null;
  return { account_type: "03000", account_number: merchantId, account_name_en: nameEn };
}
