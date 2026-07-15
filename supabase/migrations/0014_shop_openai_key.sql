-- Each shop brings its own OpenAI key, rather than every shop sharing one
-- platform-level OPENAI_API_KEY secret. Shifts the AI bill to the shop that
-- runs up the usage, and stops one shop's traffic exhausting everyone's quota.
--
-- Stored in plaintext, exactly like `slip2go_api_secret` above it: the shops
-- table is readable only by its own members (RLS) plus super_admin, and every
-- select against it in this codebase names its columns explicitly, so the key
-- reaches nothing but the admin's own settings page. Encrypting it here would
-- mean the edge functions need the decryption key anyway, which moves the
-- problem rather than solving it.
alter table public.shops add column openai_api_key text;

comment on column public.shops.openai_api_key is
  'The shop''s own OpenAI API key. Required for the RAG chatbot (embeddings + chat replies); slip verification does not use it. Never expose this to a customer-facing response.';
