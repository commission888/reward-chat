-- Regression tests for redemption, which spends real points the moment the
-- customer taps redeem. Run with:
--   supabase test db
--
-- Two mirror-image dangers live here and neither is visible from a passing
-- build: a double tap must not spend the same points twice, and a double reject
-- must not refund them twice. The second is the easy one to forget — it mints
-- points out of nothing.
--
-- Self-contained: creates its own fixtures and rolls everything back.

begin;
select plan(10);

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

-- 1. Redeeming spends the points there and then — the whole point of 0015.
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

-- 2. It went through the ledger, not a bare UPDATE.
select is(
  (select delta from public.points_transactions
   where customer_id = '55555555-5555-5555-5555-555555555555' and reason = 'redeem:Free Coffee'),
  -30,
  'the deduction is recorded in the points ledger'
);

-- 3. THE double-spend guard: the balance check is authoritative now, so a
-- second coupon against already-spent points must fail at create.
select throws_ok(
  $$ select * from public.create_redemption(
       '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE02') $$,
  'P0001',
  'insufficient points',
  'a second redemption past the remaining balance is refused at create'
);

-- 4. An inactive reward can't be redeemed even by id.
select throws_ok(
  $$ select * from public.create_redemption(
       '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000b', 'CODE03') $$,
  'P0001',
  'reward not available',
  'an inactive reward is refused'
);

-- 5. Approving no longer moves points — they went at create. Approving as staff.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select lives_ok(
  $$ select public.complete_redemption(
       (select id from public.redemptions where code = 'CODE01')) $$,
  'staff can approve a pending coupon'
);
reset role;

select is(
  (select points_balance from public.customers where id = '55555555-5555-5555-5555-555555555555'),
  20,
  'approving deducts nothing a second time'
);

-- 6. …and a coupon cannot be marked used twice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select throws_ok(
  $$ select public.complete_redemption(
       (select id from public.redemptions where code = 'CODE01')) $$,
  'P0001',
  'redemption is not pending',
  'an already-completed coupon cannot be completed again'
);
reset role;

-- 7. Rejecting refunds. Fresh pending coupon: balance 20 -> 0 -> back to 20.
select public.create_redemption(
  '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE04')
from (select 1) as _
where (select points_balance from public.customers where id = '55555555-5555-5555-5555-555555555555') >= 0;

update public.customers set points_balance = 50
where id = '55555555-5555-5555-5555-555555555555';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select lives_ok(
  $$ select public.cancel_redemption(
       (select id from public.redemptions where code = 'CODE04')) $$,
  'staff can reject a pending coupon'
);

-- 8. THE double-refund guard, the mirror of test 3: rejecting twice would hand
-- the points back twice and mint points from nothing.
select throws_ok(
  $$ select public.cancel_redemption(
       (select id from public.redemptions where code = 'CODE04')) $$,
  'P0001',
  'redemption is not pending',
  'rejecting an already-rejected coupon does not refund a second time'
);
reset role;

-- 9. create_redemption is service_role-only: Postgres grants EXECUTE to PUBLIC
-- by default, so 0015's revokes are what stop an anon key spending points.
set local role authenticated;
select throws_ok(
  $$ select * from public.create_redemption(
       '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-00000000000a', 'CODE05') $$,
  '42501',
  'create_redemption is not executable by authenticated (service_role only)'
);
reset role;

select * from finish();
rollback;
