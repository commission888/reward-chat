-- Per-shop AI provider. Until now every shop used OpenAI (shops.openai_api_key,
-- 0014). Gemini has a usable free tier, so a shop can now pick it instead and run
-- the chatbot at no cost. The choice is per-shop; the key for whichever provider
-- is active lives in its own column.
--
-- Both providers must produce the SAME embedding dimension (1536) so the existing
-- document_chunks.embedding vector(1536) column and match_document_chunks() are
-- untouched: OpenAI text-embedding-3-small is 1536 natively, and Gemini
-- gemini-embedding-001 is requested at outputDimensionality 1536. Vectors are
-- only ever compared within one shop (match_document_chunks filters by shop_id),
-- so cross-provider comparability never matters — but WITHIN a shop the ingest
-- and query embeddings must come from the same provider, which is why switching
-- provider invalidates that shop's chunks (handled in update-shop-ai-settings:
-- it deletes them and marks the files for re-upload).

alter table public.shops
  add column ai_provider text not null default 'openai'
    check (ai_provider in ('openai', 'gemini')),
  add column gemini_api_key text;

comment on column public.shops.ai_provider is
  'Which AI provider this shop uses for RAG chat + embeddings: openai | gemini. The active provider''s key is the matching *_api_key column.';
comment on column public.shops.gemini_api_key is
  'Google Gemini (AI Studio) API key, used when ai_provider = gemini. Plaintext, same as openai_api_key; never expose via a select(*) in a customer-facing function.';
