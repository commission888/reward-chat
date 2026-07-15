-- Points QR grants: the shop issues a QR worth N points and the customer scans
-- it, inverting the original direction (staff scanning the customer's card).
--
-- That inversion changes the threat model completely. The old flow's secret was
-- the customer's card, shown only to staff; here the secret is on a screen at
-- the counter, in view of anyone standing nearby with a phone. So the token is
-- the whole security boundary and a grant is deliberately single-use and
-- short-lived: a photographed QR is worthless once claimed or expired.

create table public.point_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- Who issued it. Kept so the ledger can attribute the points to a real person
  -- rather than "system"; `on delete set null` mirrors points_transactions.
  staff_user_id uuid references public.profiles (id) on delete set null,
  points integer not null check (points >= 1 and points <= 10),
  -- High-entropy and unique: holding this token is what claims the points, so
  -- it is a secret, not a human-readable code like redemptions.code.
  token text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by_customer_id uuid references public.customers (id) on delete set null,
  created_at timestamptz not null default now()
);

create index point_grants_shop_id_idx on public.point_grants (shop_id);

alter table public.point_grants enable row level security;

create policy "point_grants: super_admin full access" on public.point_grants
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "point_grants: shop members read" on public.point_grants
  for select
  using (shop_id = public.my_shop_id());

-- Read-only for clients. Issuing goes through create-point-grant and claiming
-- through claim_point_grant below, so there is no client write path at all.
grant select on public.point_grants to authenticated;
grant select, insert, update, delete on public.point_grants to service_role;

-- Claims a grant for a customer: the fourth and last legitimate writer of
-- customers.points_balance, and like the other three it goes through the
-- points_transactions ledger rather than a bare UPDATE.
--
-- The `for update` lock plus the claimed_at guard is the single-use defense —
-- two customers scanning the same QR at once serialize here, and the second
-- finds it claimed and aborts.
create or replace function public.claim_point_grant(p_token text, p_customer_id uuid)
returns table (points integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.point_grants;
  v_customer public.customers;
  v_balance integer;
begin
  select * into v_grant from public.point_grants where token = p_token for update;
  if not found then
    raise exception 'grant not found';
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer not found';
  end if;

  if v_grant.shop_id <> v_customer.shop_id then
    raise exception 'grant belongs to another shop';
  end if;

  if v_grant.claimed_at is not null then
    -- The customer app claims automatically on load, so a refresh or a double
    -- effect can fire this twice for someone who legitimately scanned once.
    -- Re-reporting their own successful claim is honest and idempotent; only
    -- a *different* person arriving second is a real failure.
    if v_grant.claimed_by_customer_id = p_customer_id then
      return query select v_grant.points, v_customer.points_balance;
    end if;
    raise exception 'already claimed';
  end if;

  if v_grant.expires_at <= now() then
    raise exception 'grant expired';
  end if;

  v_balance := v_customer.points_balance + v_grant.points;

  update public.customers
  set points_balance = v_balance
  where id = p_customer_id;

  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_grant.shop_id, p_customer_id, v_grant.staff_user_id, v_grant.points, 'qr_grant', v_balance);

  update public.point_grants
  set claimed_at = now(), claimed_by_customer_id = p_customer_id
  where id = v_grant.id;

  return query select v_grant.points, v_balance;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, so the grant below is not
-- enough on its own — without these revokes the function stays callable with a
-- plain anon key, which here would mean claiming points with a guessed token
-- and no card at all. (Same trap as 0009/0010.)
revoke execute on function public.claim_point_grant(text, uuid) from public;
revoke execute on function public.claim_point_grant(text, uuid) from anon;
revoke execute on function public.claim_point_grant(text, uuid) from authenticated;
grant execute on function public.claim_point_grant(text, uuid) to service_role;
