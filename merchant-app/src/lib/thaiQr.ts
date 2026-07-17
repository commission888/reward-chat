import jsQR from "jsqr";

// Reads a shop's Thai QR Payment / KShop standee QR and pulls out the receiver
// identity Slip2Go matches on. A KShop QR carries no bank account number — the
// value that matches (Slip2Go accountType "03000") is the Merchant ID, e.g.
// "KB000002209056", which the EMVCo payload stores inside its merchant
// account-info templates (tags 30/31, sub-field 02) and also inside the printed
// reference. Confirmed by decoding a live CNX Haircutz KShop QR.

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

// KShop Merchant IDs are "KB" + digits (e.g. KB000002209056).
const MERCHANT_ID_RE = /^KB\d{6,}$/;

// Merchant account-information templates live in tags 26–51; the merchant name
// is tag 59. We search those templates' sub-fields for a KShop Merchant ID
// rather than hard-coding a sub-tag, so a small layout change in the QR doesn't
// silently break extraction.
export function extractKShopReceiver(payload: string): ParsedQrReceiver | null {
  const top = parseTlv(payload);
  let merchantId: string | null = null;
  let nameEn = "";

  for (const t of top) {
    if (t.tag === "59") nameEn = t.value.trim();
    if (t.tag >= "26" && t.tag <= "51") {
      for (const sub of parseTlv(t.value)) {
        const v = sub.value.trim();
        if (!merchantId && MERCHANT_ID_RE.test(v)) merchantId = v;
      }
    }
  }

  if (!merchantId) return null;
  return { account_type: "03000", account_number: merchantId, account_name_en: nameEn };
}
