-- Fixes 0015's create_redemption, which installed cleanly and then failed on
-- every call with 42702 "column reference id is ambiguous".
--
-- `returns table (id, reward_name, points_cost, code, status, created_at)` puts
-- all six names in scope as OUT variables, so a bare `where id = p_customer_id`
-- can mean either the parameter or the column. Postgres only resolves that at
-- call time — which is why CREATE succeeded and the very first redeem blew up.
-- A migration applying cleanly proves nothing about a plpgsql body.
--
-- Every table is now aliased and every column qualified through the alias, so
-- no reference can collide with an OUT name.
--
-- 0015 is left as it was rather than edited: it is already applied to
-- production, so repo and remote stay in lockstep by fixing forward.

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

  insert into public.redemptions (shop_id, customer_id, reward_id, reward_name, points_cost, code, status)
  values (v_customer.shop_id, p_customer_id, v_reward.id, v_reward.name, v_reward.points_cost, p_code, 'pending')
  returning * into v_redemption;

  return query select v_redemption.id, v_redemption.reward_name, v_redemption.points_cost,
                      v_redemption.code, v_redemption.status, v_redemption.created_at;
end;
$$;

-- create or replace resets the ACL, so 0015's lockdown has to be restated.
revoke execute on function public.create_redemption(uuid, uuid, text) from public;
revoke execute on function public.create_redemption(uuid, uuid, text) from anon;
revoke execute on function public.create_redemption(uuid, uuid, text) from authenticated;
grant execute on function public.create_redemption(uuid, uuid, text) to service_role;
