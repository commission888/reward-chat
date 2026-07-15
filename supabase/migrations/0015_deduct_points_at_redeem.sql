-- Moves the point deduction from staff-approval time to the moment the customer
-- taps redeem.
--
-- 0011 deducted only on approval, on the reasoning that a customer has no
-- Supabase JWT so the balance write should ride on a trusted staff action. That
-- holds, but it made the customer's own balance lie to them: they tap redeem,
-- collect a coupon, and their points sit untouched until a staff member gets
-- around to it — meanwhile they can redeem again against points they've already
-- spent. Redeeming is now a purchase: the points go immediately, and the coupon
-- is the receipt.
--
-- The customer still never writes the balance. create_redemption is SECURITY
-- DEFINER and service_role-only; create-redemption proves identity via the
-- signed loyalty token and calls it. What changed is *when*, not *who*.
--
-- Consequence, and the reason cancel had to change too: rejecting a coupon must
-- now hand the points back, or a reject would simply take them.

-- --------------------------------------------------------------- create --
-- Everything in one transaction under a customer row lock: the balance check is
-- now authoritative rather than advisory, so two fast taps can't both pass it.
create or replace function public.create_redemption(
  p_customer_id uuid,
  p_reward_id uuid,
  p_code text
)
returns table (id uuid, reward_name text, points_cost integer, code text, status text, created_at timestamptz)
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
  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'customer not found';
  end if;

  select * into v_reward from public.rewards where id = p_reward_id;
  if not found or v_reward.shop_id <> v_customer.shop_id or not v_reward.active then
    raise exception 'reward not available';
  end if;

  -- The shop's floor on redeeming at all, on top of the reward's own price.
  select (points_config ->> 'redeem_threshold')::integer into v_threshold
  from public.shops where id = v_customer.shop_id;
  if v_threshold is not null and v_customer.points_balance < v_threshold then
    raise exception 'below redeem threshold';
  end if;

  if v_customer.points_balance < v_reward.points_cost then
    raise exception 'insufficient points';
  end if;

  v_balance := v_customer.points_balance - v_reward.points_cost;

  update public.customers set points_balance = v_balance where id = p_customer_id;

  -- staff_user_id is null: nobody at the shop did this, the customer did. That
  -- surfaces as "system" in the merchant's history view, which is accurate.
  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_customer.shop_id, p_customer_id, null, -v_reward.points_cost,
          'redeem:' || v_reward.name, v_balance);

  -- name and cost are snapshotted so later edits or deletion of the reward
  -- don't rewrite history (0011's reasoning, unchanged).
  insert into public.redemptions (shop_id, customer_id, reward_id, reward_name, points_cost, code, status)
  values (v_customer.shop_id, p_customer_id, v_reward.id, v_reward.name, v_reward.points_cost, p_code, 'pending')
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.reward_name, v_redemption.points_cost,
                      v_redemption.code, v_redemption.status, v_redemption.created_at;
end;
$$;

revoke execute on function public.create_redemption(uuid, uuid, text) from public;
revoke execute on function public.create_redemption(uuid, uuid, text) from anon;
revoke execute on function public.create_redemption(uuid, uuid, text) from authenticated;
grant execute on function public.create_redemption(uuid, uuid, text) to service_role;

-- ------------------------------------------------------------- complete --
-- No longer touches points — they went at create. Approval is now only the
-- shop confirming they handed the thing over. The pending guard stays: it stops
-- a coupon being marked used twice.
--
-- It used to return the new balance, and there is no balance to return any
-- more. Postgres refuses to change a return type via `create or replace`
-- (42P13), so this must drop first — which silently discards the function's
-- grants with it. The re-grant further down is therefore not boilerplate:
-- without it, staff lose the ability to approve coupons at all.
drop function if exists public.complete_redemption(uuid);

create function public.complete_redemption(p_redemption_id uuid)
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

  select * into v_redemption from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'redemption not found';
  end if;

  if v_redemption.shop_id <> v_caller_shop_id then
    raise exception 'redemption does not belong to caller shop';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception 'redemption is not pending';
  end if;

  update public.redemptions
  set status = 'completed', staff_user_id = auth.uid(), completed_at = now()
  where id = p_redemption_id;
end;
$$;

-- --------------------------------------------------------------- cancel --
-- Now a refund, which makes it as dangerous as the deduction was: without the
-- lock and the pending guard, rejecting twice would hand the points back twice
-- and mint points out of nothing. Same shape of defense as the deduct path.
create or replace function public.cancel_redemption(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.redemptions;
  v_customer public.customers;
  v_caller_role text;
  v_caller_shop_id uuid;
  v_balance integer;
begin
  select role, shop_id into v_caller_role, v_caller_shop_id
  from public.profiles where id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'not authorized';
  end if;

  select * into v_redemption from public.redemptions where id = p_redemption_id for update;
  if not found then
    raise exception 'redemption not found';
  end if;

  if v_redemption.shop_id <> v_caller_shop_id then
    raise exception 'redemption does not belong to caller shop';
  end if;

  if v_redemption.status <> 'pending' then
    raise exception 'redemption is not pending';
  end if;

  select * into v_customer from public.customers where id = v_redemption.customer_id for update;
  if not found then
    raise exception 'customer not found';
  end if;

  v_balance := v_customer.points_balance + v_redemption.points_cost;

  update public.customers set points_balance = v_balance where id = v_customer.id;

  -- Its own reason, so a refund is never mistaken for an earning in the history.
  insert into public.points_transactions (shop_id, customer_id, staff_user_id, delta, reason, balance_after)
  values (v_redemption.shop_id, v_customer.id, auth.uid(), v_redemption.points_cost,
          'redeem_refund:' || v_redemption.reward_name, v_balance);

  update public.redemptions
  set status = 'cancelled', staff_user_id = auth.uid()
  where id = p_redemption_id;
end;
$$;

-- Restores what the DROP above threw away. cancel_redemption keeps its own
-- grants (replaced, not dropped), but both are restated so the pair reads in one
-- place rather than having to be inferred from 0011.
grant execute on function public.complete_redemption(uuid) to authenticated, service_role;
grant execute on function public.cancel_redemption(uuid) to authenticated, service_role;

-- ------------------------------------------------- existing pending rows --
-- Anything pending right now was created under the old model: no points were
-- ever taken for it. Approving it after this migration would give the reward
-- for free; cancelling it would refund points that were never deducted. Neither
-- RPC can tell the difference, so retire them here with a bare UPDATE — using
-- the new cancel_redemption would perform exactly the bogus refund we're
-- avoiding. Balances are deliberately left untouched.
update public.redemptions set status = 'cancelled' where status = 'pending';
