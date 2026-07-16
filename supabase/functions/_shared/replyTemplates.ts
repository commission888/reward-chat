// Mirror of packages/shared/src/replyTemplates.ts — see that file for why the
// set is what it is (standalone sentences only, th/en pair for chat but not for
// slips). Two copies on purpose: this runs on Deno and can't import the npm
// workspace, and reaching outside supabase/functions breaks the deploy bundle.
// Change one, change the other. This copy is the one that decides what a
// customer actually reads.

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

// A blank override resolves to the default, never to an empty message: an empty
// reply would throw at the LINE API and land in handleMessage's log-only catch,
// which means the customer hears nothing at all. Clearing a field in the
// merchant form is a reset, not a mute.
export function resolveReplyTemplate(
  templates: ReplyTemplates | null | undefined,
  key: ReplyTemplateKey
): string {
  const custom = templates?.[key];
  return typeof custom === "string" && custom.trim() !== "" ? custom : REPLY_TEMPLATE_DEFAULTS[key];
}

export const REPLY_TEMPLATE_MAX_LENGTH = 1000;

// The column is `jsonb not null default '{}'`, but a shop row could still hold
// junk from a bad write, so treat anything that isn't a string-valued object as
// "no overrides" rather than letting it reach the resolver.
export function parseReplyTemplates(value: unknown): ReplyTemplates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out as ReplyTemplates;
}
