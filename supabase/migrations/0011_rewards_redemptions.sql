-- Rewards catalog + point redemptions.
--
-- Flow: an admin defines `rewards` (name + points_cost). A customer redeems one
-- from the LIFF app, which creates a `pending` row in `redemptions` (via the
-- create-redemption edge function — customers have no JWT, so identity is
-- proven by their signed loyalty qr_token). Points are NOT deducted at this
-- point: the customer cannot deduct their own balance. Shop staff/admin later
-- approve the pending redemption in the merchant app, which calls
-- `complete_redemption` (security definer) to deduct the points through the
-- same ledger `apply_points` uses, attributing the change to the approver.

create table public.rewards (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index rewards_shop_id_idx on public.rewards (shop_id);

create table public.redemptions (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  -- Keep the row (and its snapshot columns) even if the reward is later
  -- deleted, so redemption history stays intact.
  reward_id uuid references public.rewards (id) on delete set null,
  -- Snapshots taken at redeem time: editing/deleting the reward later must not
  -- change an outstanding coupon's name or cost.
  reward_name text not null,
  points_cost integer not null check (points_cost > 0),
  -- Short human-friendly code shown on the customer's coupon so staff can match
  -- it against the pending list.
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  staff_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index redemptions_shop_status_idx on public.redemptions (shop_id, status);
create index redemptions_customer_id_idx on public.redemptions (customer_id);

-- --------------------------------------------------------------------- RLS --
alter table public.rewards enable row level security;
alter table public.redemptions enable row level security;

-- rewards: super_admin everything; any shop member reads their shop's rewards;
-- only a shop admin manages them. Reads/writes use the security-definer helpers
-- (never a direct profiles subquery) to avoid 42P17.
create policy "rewards: super_admin full access" on public.rewards
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "rewards: shop members read" on public.rewards
  for select
  using (shop_id = public.my_shop_id());

create policy "rewards: shop admin manage" on public.rewards
  for all
  using (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  )
  with check (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  );

-- redemptions: super_admin everything; shop staff/admin read their shop's rows
-- (the pending-approval list). No client insert/update: inserts come from the
-- create-redemption edge function (service role) and status changes come from
-- the complete_redemption / cancel_redemption RPCs (security definer).
create policy "redemptions: super_admin full access" on public.redemptions
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "redemptions: shop members read" on public.redemptions
  for select
  using (shop_id = public.my_shop_id());

-- ------------------------------------------------------------------ grants --
grant select, insert, update, delete on public.rewards to authenticated, service_role;

-- Client-side is read-only (RLS above); writes go through service_role /
-- security-definer RPCs, mirroring points_transactions.
grant select on public.redemptions to authenticated;
grant select, insert, update, delete on public.redemptions to service_role;

-- ------------------------------------------------- complete_redemption RPC --
-- Approves a pending redemption: validates the caller is staff/admin of the
-- shop, then atomically (under row locks) deducts the snapshotted points_cost
-- through the points ledger and flips the row to 'completed'. The
-- `status = 'pending'` guard under `for update` is the idempotency lock — a
-- second approval of the same coupon finds it non-pending and errors before
-- any deduction, so a coupon can never be redeemed twice.
create or replace function public.complete_redemption(p_redemption_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_shop_id uuid;
  v_redemption public.redemptions%rowtype;
  v_balance integer;
begin
  select role, shop_id into v_caller_role, v_caller_shop_id
  from public.profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;

  select * into v_redemption
  from public.redemptions
  where id = p_redemption_id
  for update;

  if not found then
    raise exception 'redemption not found';
  end if;

  if v_redemption.shop_id <> v_caller_shop_id then
    raise exception 'redemption does not belong to caller shop';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception 'redemption already %', v_redemption.status;
  end if;

  select points_balance into v_balance
  from public.customers
  where id = v_redemption.customer_id
  for update;

  if v_balance < v_redemption.points_cost then
    raise exception 'insufficient balance';
  end if;

  update public.customers
  set points_balance = v_balance - v_redemption.points_cost
  where id = v_redemption.customer_id;

  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (
    v_redemption.shop_id,
    v_redemption.customer_id,
    auth.uid(),
    -v_redemption.points_cost,
    'redeem:' || v_redemption.reward_name,
    v_balance - v_redemption.points_cost
  );

  update public.redemptions
  set status = 'completed', staff_user_id = auth.uid(), completed_at = now()
  where id = p_redemption_id;

  return v_balance - v_redemption.points_cost;
end;
$$;

-- Rejects a pending redemption without deducting points. Same authorization and
-- pending-guard as complete_redemption.
create or replace function public.cancel_redemption(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_shop_id uuid;
  v_redemption public.redemptions%rowtype;
begin
  select role, shop_id into v_caller_role, v_caller_shop_id
  from public.profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;

  select * into v_redemption
  from public.redemptions
  where id = p_redemption_id
  for update;

  if not found then
    raise exception 'redemption not found';
  end if;

  if v_redemption.shop_id <> v_caller_shop_id then
    raise exception 'redemption does not belong to caller shop';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception 'redemption already %', v_redemption.status;
  end if;

  update public.redemptions
  set status = 'cancelled', staff_user_id = auth.uid(), completed_at = now()
  where id = p_redemption_id;
end;
$$;

grant execute on function public.complete_redemption(uuid) to authenticated, service_role;
grant execute on function public.cancel_redemption(uuid) to authenticated, service_role;
