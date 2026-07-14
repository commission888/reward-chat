-- Payment-slip verification via Slip2Go (https://slip2go.com), triggered when
-- a customer sends a slip photo directly in the LINE chat. The webhook
-- forwards the image to Slip2Go, and on a genuine/unused slip, credits
-- points automatically based on the shop's points_config.points_per_baht.

alter table public.shops
  add column slip2go_api_secret text,
  add column slip_receiver_account_type text,
  add column slip_receiver_account_name_th text,
  add column slip_receiver_account_name_en text,
  add column slip_receiver_account_number text;

comment on column public.shops.slip2go_api_secret is
  'When set, the LINE webhook auto-verifies slip images customers send in chat.';
comment on column public.shops.slip_receiver_account_number is
  'If left blank, ANY genuine bank slip (even one paid to someone else entirely) '
  'will be accepted as proof of payment to this shop — Slip2Go only confirms the '
  'slip is real, not who it was paid to, unless a receiver account is given to check against.';

-- Ledger of processed slips: (a) an audit trail an admin can review, and
-- (b) an idempotency guard — the unique constraint on (shop_id, trans_ref)
-- stops the same slip from being credited twice even if a customer resends
-- the same image (Slip2Go's own checkDuplicate flag is a second layer, not
-- a substitute — see apply-slip-webhook below).
create table public.slip_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  trans_ref text,
  reference_id text,
  amount numeric,
  sender_name text,
  bank_name text,
  slip2go_code text not null,
  status text not null check (status in ('credited', 'rejected', 'duplicate', 'error')),
  points_awarded integer,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  -- Postgres treats every NULL as distinct under a UNIQUE constraint, so
  -- rejected/error rows (no trans_ref) never collide with each other —
  -- this only actually constrains the genuinely-found, credited slips.
  unique (shop_id, trans_ref)
);

create index slip_verifications_shop_id_idx on public.slip_verifications (shop_id);
create index slip_verifications_customer_id_idx on public.slip_verifications (customer_id);

alter table public.slip_verifications enable row level security;

create policy "slip_verifications: super_admin full access" on public.slip_verifications
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "slip_verifications: shop staff read" on public.slip_verifications
  for select
  using (shop_id = public.my_shop_id());

grant select on public.slip_verifications to authenticated;
grant select, insert, update, delete on public.slip_verifications to service_role;

-- System-driven point credit (no staff/admin caller — the LINE webhook runs
-- as service_role with no auth.uid()). This is deliberately a *separate*
-- function from `apply_points` rather than relaxing apply_points' own role
-- check: apply_points staying staff/admin-only is what makes the QR-scan
-- path trustworthy, and this function is only reachable by trusted backend
-- code because EXECUTE is granted to service_role only, never authenticated.
create or replace function public.apply_points_system(
  p_customer_id uuid,
  p_delta integer,
  p_reason text default 'slip_verified'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_shop_id uuid;
begin
  if p_delta <= 0 then
    raise exception 'delta must be positive';
  end if;

  select points_balance, shop_id into v_balance, v_shop_id
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'customer not found';
  end if;

  update public.customers
  set points_balance = v_balance + p_delta
  where id = p_customer_id;

  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_shop_id, p_customer_id, null, p_delta, p_reason, v_balance + p_delta);

  return v_balance + p_delta;
end;
$$;

grant execute on function public.apply_points_system(uuid, integer, text) to service_role;
