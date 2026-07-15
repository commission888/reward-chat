-- Fixes a fall-through in 0012's claim_point_grant.
--
-- plpgsql's RETURN QUERY appends rows to the result set and *keeps executing* —
-- it is not a return statement. So the idempotent branch (the same customer
-- re-claiming their own grant) queued its result and then ran straight on into
-- `raise exception 'already claimed'`, turning the one case that was meant to
-- pass quietly into an error. The customer app auto-claims on load, so this
-- fired on any refresh: points already credited, scary red error on screen.
--
-- Caught by exercising the RPC against the database; nothing about it is visible
-- from a type-check or a build.

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
      return; -- RETURN QUERY alone would fall through to the raise below.
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

-- create or replace resets the function's ACL, so the 0012 lockdown has to be
-- restated here. Leaving this out would silently hand EXECUTE back to PUBLIC.
revoke execute on function public.claim_point_grant(text, uuid) from public;
revoke execute on function public.claim_point_grant(text, uuid) from anon;
revoke execute on function public.claim_point_grant(text, uuid) from authenticated;
grant execute on function public.claim_point_grant(text, uuid) to service_role;
