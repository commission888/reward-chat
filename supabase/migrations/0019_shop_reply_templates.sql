-- Lets a shop admin override the chatbot's canned replies from /settings/ai.
--
-- Its own column rather than a key inside `points_config`: that jsonb is a
-- shared bag (points_per_baht / points_per_slip / redeem_threshold) and every
-- writer of it has to read-modify-write or silently wipe slip crediting. A
-- dedicated column keeps this feature out of that trap entirely.
--
-- Sparse by design — `{}` means "use the system defaults for everything", and a
-- key is present only for a sentence the shop actually rewrote. The defaults
-- therefore live in code (_shared/replyTemplates.ts), never seeded into this
-- column: seeding would freeze today's wording into every shop's row, so a later
-- improvement to a default would reach nobody, and there'd be no way to tell
-- "the shop chose this text" apart from "the shop never touched it".
--
-- No grant changes needed: 0007 already grants shops to authenticated (RLS is
-- what limits writes to super_admin), so a shop admin still can't write this
-- directly — `update-shop-reply-templates` is the sanctioned path, exactly like
-- openai_api_key and points_config.
alter table public.shops
  add column reply_templates jsonb not null default '{}'::jsonb;

comment on column public.shops.reply_templates is
  'Per-shop overrides for the LINE bot''s canned replies, keyed by the ids in supabase/functions/_shared/replyTemplates.ts (e.g. chat.no_answer_th, slip.duplicate). Sparse: a missing or blank key falls back to the system default in that file. Never contains placeholders — only the standalone sentences, not the slip Flex card.';
