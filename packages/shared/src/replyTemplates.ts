// The LINE bot's canned replies, and the shop's ability to rewrite them.
//
// Only the *standalone sentences* live here — the ones the bot sends as a plain
// message on their own. The verified-slip Flex card is deliberately not
// configurable: it's a structured receipt whose lines carry runtime numbers, so
// making it editable would mean handing shops `{points}`-style placeholders to
// type correctly, and a typo would ship a literal `{points}` to a customer.
//
// IMPORTANT: supabase/functions/_shared/replyTemplates.ts is a hand-kept mirror
// of this file. Edge functions run on Deno and don't consume this npm workspace,
// so the two copies exist on purpose — change one, change the other. Drift here
// is cosmetic (the merchant form would show a stale placeholder), never a wrong
// reply: the webhook only ever reads its own copy.

// Language: `chat.no_answer` has a th/en pair because a text message carries the
// customer's own words, and one Thai character is enough to tell which language
// to answer in. The slip replies have no pair because a slip is an *image* —
// there is no text to detect a language from, which is why they've always been
// Thai-only. A shop that serves English customers rewrites them in English.
export const REPLY_TEMPLATE_DEFAULTS = {
  "chat.no_answer_th": "ขออภัย ไม่มีข้อมูลเรื่องนี้ กรุณาติดต่อร้านโดยตรง",
  "chat.no_answer_en": "Sorry, I don't have information about that. Please contact the shop directly.",
  "slip.receiver_mismatch": "บัญชีผู้รับในสลิปไม่ตรงกับบัญชีร้านค้า",
  "slip.amount_mismatch": "ยอดเงินในสลิปไม่ตรงกับที่คาดไว้",
  "slip.date_mismatch": "วันที่โอนในสลิปไม่ตรงกับที่คาดไว้",
  "slip.not_found": "ไม่พบรายการนี้ในระบบธนาคาร กรุณาตรวจสอบสลิปอีกครั้ง",
  "slip.forged": "สลิปนี้อาจถูกปลอมแปลงหรือเสียหาย",
  "slip.duplicate": "สลิปนี้เคยถูกใช้ไปแล้ว",
  "slip.bank_error": "ระบบธนาคารขัดข้อง กรุณาลองใหม่อีกครั้ง",
  "slip.unknown": "ไม่สามารถตรวจสอบสลิปนี้ได้ กรุณาส่งรูปสลิปที่ชัดเจน",
  "slip.system_error": "ขออภัย ระบบไม่สามารถตรวจสอบสลิปได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
} as const;

export type ReplyTemplateKey = keyof typeof REPLY_TEMPLATE_DEFAULTS;

export const REPLY_TEMPLATE_KEYS = Object.keys(REPLY_TEMPLATE_DEFAULTS) as ReplyTemplateKey[];

export type ReplyTemplates = Partial<Record<ReplyTemplateKey, string>>;

// A blank override resolves to the default rather than to an empty message —
// that's what makes clearing a field in the merchant form mean "reset this one",
// and it's the guard that stops a stray "" from muting the bot.
export function resolveReplyTemplate(
  templates: ReplyTemplates | null | undefined,
  key: ReplyTemplateKey
): string {
  const custom = templates?.[key];
  return typeof custom === "string" && custom.trim() !== "" ? custom : REPLY_TEMPLATE_DEFAULTS[key];
}

// LINE hard-caps a text message at 5000 characters; anything approaching that is
// a paste accident rather than a reply, so the save endpoint rejects it early.
export const REPLY_TEMPLATE_MAX_LENGTH = 1000;
