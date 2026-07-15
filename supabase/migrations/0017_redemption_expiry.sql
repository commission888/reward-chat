-- Coupons now expire a month after they're redeemed, and the points are gone
-- for good either way.
--
-- 0015 made rejecting a refund, which was the honest consequence of deducting up
-- front. The shop wants the opposite: redeeming is final. So a coupon nobody
-- collects simply dies of old age — the points stay spent, like a voucher you
-- bought and never used. That removes the only reason cancel_redemption existed,
-- and it is dropped in 0018 (separately, so the Reject button can leave the
-- deployed frontend before the function it calls disappears).
--
-- Expiry is a fact about the clock, not a state to maintain: no job flips rows,
-- nothing sweeps. A coupon is dead when now() passes expires_at, and the check
-- lives at the point of use. Same shape as point_grants.

-- default covers new rows; the backfill covers the ones already here, which the
-- NOT NULL would otherwise reject. Both are needed.
alter table public.redemptions
  add column expires_at timestamptz not null default (now() + interval '1 month');

update public.redemptions set expires_at = created_at + interval '1 month';

comment on column public.redemptions.expires_at is
  'When this coupon stops being redeemable. No job enforces it — complete_redemption refuses a coupon past this, and the apps compute "expired" from the clock. Points are never returned on expiry.';

-- --------------------------------------------------------------- create --
-- Same body as 0016 (aliases kept — `returns table (id, code, status, ...)` puts
-- those names in scope, so an unqualified `where id = ...` is ambiguous and only
-- fails at call time), plus the coupon's lifespan.
create or replace function public.create_redemption(
  p_customer_id uuid,
  p_reward_id uuid,
  p_code text
)
returns table (id uuid, reward_name text, points_cost integer, code text, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers;
  v_reward public.rewards;
  v_threshold integer;
  v_balance integer;
  v_redemption public.redemptions;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if not found then
    raise exception 'customer not found';
  end if;

  select * into v_reward from public.rewards r where r.id = p_reward_id;
  if not found or v_reward.shop_id <> v_customer.shop_id or not v_reward.active then
    raise exception 'reward not available';
  end if;

  select (s.points_config ->> 'redeem_threshold')::integer into v_threshold
  from public.shops s where s.id = v_customer.shop_id;
  if v_threshold is not null and v_customer.points_balance < v_threshold then
    raise exception 'below redeem threshold';
  end if;

  if v_customer.points_balance < v_reward.points_cost then
    raise exception 'insufficient points';
  end if;

  v_balance := v_customer.points_balance - v_reward.points_cost;

  update public.customers c set points_balance = v_balance where c.id = p_customer_id;

  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_customer.shop_id, p_customer_id, null, -v_reward.points_cost,
          'redeem:' || v_reward.name, v_balance);

  insert into public.redemptions (shop_id, customer_id, reward_id, reward_name, points_cost, code, status, expires_at)
  values (v_customer.shop_id, p_customer_id, v_reward.id, v_reward.name, v_reward.points_cost, p_code, 'pending',
          now() + interval '1 month')
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.reward_name, v_redemption.points_cost,
                      v_redemption.code, v_redemption.status, v_redemption.created_at,
                      v_redemption.expires_at;
end;
$$;

revoke execute on function public.create_redemption(uuid, uuid, text) from public;
revoke execute on function public.create_redemption(uuid, uuid, text) from anon;
revoke execute on function public.create_redemption(uuid, uuid, text) from authenticated;
grant execute on function public.create_redemption(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------- complete --
-- The expiry check belongs here, not only in the UI: the UI's disabled button is
-- a courtesy, this is the rule. Without it, a stale page or a direct RPC call
-- could still honour a dead coupon.
create or replace function public.complete_redemption(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.redemptions;
  v_caller_role text;
  v_caller_shop_id uuid;
begin
  select role, shop_id into v_caller_role, v_caller_shop_id
  from public.profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;

  select * into v_redemption from public.redemptions r where r.id = p_redemption_id for update;
  if not found then
    raise exception 'redemption not found';
  end if;

  if v_redemption.shop_id <> v_caller_shop_id then
    raise exception 'redemption does not belong to caller shop';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception 'redemption is not pending';
  end if;

  if v_redemption.expires_at <= now() then
    raise exception 'redemption has expired';
  end if;

  update public.redemptions r
  set status = 'completed', staff_user_id = auth.uid(), completed_at = now()
  where r.id = p_redemption_id;
end;
$$;

grant execute on function public.complete_redemption(uuid) to authenticated, service_role;
