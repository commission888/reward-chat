-- Append-only points ledger and the RPC that mediates every balance change.
-- `customers.points_balance` is a denormalized cache; this ledger is the source
-- of truth and the audit trail (who changed what, when, and why).

create table public.points_transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  staff_user_id uuid references public.profiles (id) on delete set null,
  delta integer not null,
  reason text,
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create index points_transactions_shop_id_idx on public.points_transactions (shop_id);
create index points_transactions_customer_id_idx on public.points_transactions (customer_id);

-- Applies a point delta atomically: locks the customer row, rejects a would-be
-- negative balance, writes the ledger entry, and updates the cached balance.
-- Runs `security definer` so it can be called with the caller's own JWT
-- (auth.uid() stays meaningful) while still enforcing role/shop checks itself,
-- rather than trusting RLS `with check` clauses to catch every invariant.
create or replace function public.apply_points(
  p_customer_id uuid,
  p_delta integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_shop_id uuid;
  v_caller_role text;
  v_caller_shop_id uuid;
begin
  select role, shop_id into v_caller_role, v_caller_shop_id
  from public.profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;

  select points_balance, shop_id into v_balance, v_shop_id
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'customer not found';
  end if;

  if v_shop_id <> v_caller_shop_id then
    raise exception 'customer does not belong to caller shop';
  end if;

  if v_balance + p_delta < 0 then
    raise exception 'insufficient balance';
  end if;

  update public.customers
  set points_balance = v_balance + p_delta
  where id = p_customer_id;

  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_shop_id, p_customer_id, auth.uid(), p_delta, p_reason, v_balance + p_delta);

  return v_balance + p_delta;
end;
$$;
