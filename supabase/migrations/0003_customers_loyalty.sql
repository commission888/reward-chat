-- Customers (LINE-identified, not Supabase Auth users) and their loyalty cards.

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  line_user_id text not null,
  display_name text,
  picture_url text,
  phone text,
  points_balance integer not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, line_user_id)
);

create index customers_shop_id_idx on public.customers (shop_id);

create table public.loyalty_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null unique references public.customers (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  qr_token text not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index loyalty_cards_shop_id_idx on public.loyalty_cards (shop_id);

-- Optional debugging log of LINE chat turns, useful for tuning RAG quality.
create table public.chat_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  message_text text not null,
  created_at timestamptz not null default now()
);

create index chat_logs_shop_id_idx on public.chat_logs (shop_id);
