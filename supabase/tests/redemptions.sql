-- Regression tests for redemption, which spends real points the moment the
-- customer taps redeem and never gives them back. Run with:
--   supabase test db
--
-- Redeeming is final: there is no refund and no cancel. The only thing standing
-- between a customer and a reward they paid for is the one-month clock, so the
-- guards worth pinning are the double-spend at create and the expiry at use.
-- Neither is visible from a passing build.
--
-- Self-contained: creates its own fixtures and rolls everything back.

begin;
select plan(11);

-- Fixture: Demo Coffee Shop (11111111-…) / staff@demo.local (44444444-…) /
-- customer Alice (55555555-…) come from seed.sql.
update public.customers set points_balance = 50
where id = '55555555-5555-5555-5555-555555555555';

insert into public.rewards (id, shop_id, name, points_cost, active)
values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'Free Coffee', 30, true),
  ('aaaaaaaa-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   'Retired Mug', 10, false);

-- 1-3. Redeeming spends the points there and then, through the ledger.
select is(
  (select points_cost from public.create_redemption(
     '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE01')),
  30,
  'create_redemption returns the snapshotted cost'
);

select is(
  (select points_balance from public.customers where id = '55555555-5555-5555-5555-555555555555'),
  20,
  'the points are gone immediately (50 - 30), not held until approval'
);

select is(
  (select delta from public.points_transactions
   where customer_id = '55555555-5555-5555-5555-555555555555' and reason = 'redeem:Free Coffee'),
  -30,
  'the deduction goes through the points ledger, not a bare UPDATE'
);

-- 4. The coupon carries a one-month deadline from the moment it was bought.
select ok(
  (select expires_at from public.redemptions where code = 'CODE01')
    between now() + interval '29 days' and now() + interval '32 days',
  'a new coupon expires about a month out'
);

-- 5. THE double-spend guard: the balance check is authoritative, so a second
-- coupon against already-spent points fails at create.
select throws_ok(
  $$ select * from public.create_redemption(
       '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE02') $$,
  'P0001',
  'insufficient points',
  'a second redemption past the remaining balance is refused at create'
);

-- 6. An inactive reward can't be redeemed even if its id is known.
select throws_ok(
  $$ select * from public.create_redemption(
       '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000b', 'CODE03') $$,
  'P0001',
  'reward not available',
  'an inactive reward is refused'
);

-- 7-9. Approving is now only the shop confirming they handed the reward over:
-- it moves no points, and can't happen twice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);

select lives_ok(
  $$ select public.complete_redemption((select id from public.redemptions where code = 'CODE01')) $$,
  'staff can approve a pending coupon'
);

select is(
  (select points_balance from public.customers where id = '55555555-5555-5555-5555-555555555555'),
  20,
  'approving moves no points — they went at redeem time'
);

select throws_ok(
  $$ select public.complete_redemption((select id from public.redemptions where code = 'CODE01')) $$,
  'P0001',
  'redemption is not pending',
  'an already-completed coupon cannot be completed again'
);
reset role;

-- 10-11. THE expiry guard. Nothing sweeps these rows, so an expired coupon is
-- still status='pending' — the deadline is enforced where it's used, not by a
-- job. Backdate one and confirm staff can't honour it, and that refusing it
-- hands nothing back.
update public.customers set points_balance = 50
where id = '55555555-5555-5555-5555-555555555555';

select public.create_redemption(
  '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE04');

update public.redemptions set expires_at = now() - interval '1 day' where code = 'CODE04';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);

select throws_ok(
  $$ select public.complete_redemption((select id from public.redemptions where code = 'CODE04')) $$,
  'P0001',
  'redemption has expired',
  'a coupon past its expiry cannot be honoured, even though it is still "pending"'
);
reset role;

select is(
  (select points_balance from public.customers where id = '55555555-5555-5555-5555-555555555555'),
  20,
  'an expired coupon returns nothing — the points stay spent'
);

select * from finish();
rollback;
