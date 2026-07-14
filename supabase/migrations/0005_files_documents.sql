-- Knowledge-base files and their embedded chunks for the RAG chatbot.

create table public.files (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  error_message text,
  created_at timestamptz not null default now()
);

create index files_shop_id_idx on public.files (shop_id);

create table public.document_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(1536),
  token_count integer,
  created_at timestamptz not null default now()
);

create index document_chunks_shop_id_idx on public.document_chunks (shop_id);
create index document_chunks_file_id_idx on public.document_chunks (file_id);

-- Brute-force cosine search is fine at expected per-shop chunk volumes.
-- Add an HNSW index later if a shop's knowledge base grows large:
--   create index on document_chunks using hnsw (embedding vector_cosine_ops);
create or replace function public.match_document_chunks(
  p_shop_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 5
)
returns table (
  id uuid,
  file_id uuid,
  content text,
  distance float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    document_chunks.id,
    document_chunks.file_id,
    document_chunks.content,
    document_chunks.embedding <=> p_query_embedding as distance
  from public.document_chunks
  where document_chunks.shop_id = p_shop_id
  order by document_chunks.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- Private storage bucket for uploaded .docx/.xlsx knowledge-base files.
insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;
