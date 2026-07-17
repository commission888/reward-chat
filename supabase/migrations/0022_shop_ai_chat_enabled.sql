-- On/off switch for the RAG chatbot, independent of the AI key. A shop that only
-- wants automatic slip-crediting can turn the bot off so it stops replying to
-- text messages, while image/slip verification keeps working (line-webhook gates
-- only the text branch on this). Defaults true so existing shops keep answering.

alter table public.shops
  add column ai_chat_enabled boolean not null default true;

comment on column public.shops.ai_chat_enabled is
  'When false, line-webhook does not reply to text messages (the chatbot is off). Slip/image verification is unaffected.';
