-- Regression tests for the points-QR grant flow. Run with:
--   supabase test db
--
-- These guards are the whole security model of a QR that hands out points from
-- a screen at the counter: without them a photographed code is reusable, a
-- forever-valid code is farmable, and a code from one shop credits at another.
-- None of it is observable from a passing build, so it is pinned here.
--
-- Self-contained: creates its own fixtures and rolls everything back.

begin;
select plan(7);

-- Fixtures. Demo Coffee Shop (11111111-…) / staff@demo.local (44444444-…) /
-- customer Alice (55555555-…) come from seed.sql; a second shop + customer give
-- us the cross-tenant case, and a second Demo customer gives us "someone else
-- got here first".
insert into public.shops (id, name, slug)
values ('77777777-7777-7777-7777-777777777777', 'Test Salon', 'test-salon');

insert into public.customers (id, shop_id, line_user_id, display_name, points_balance)
values
  ('99999999-9999-9999-9999-999999999999', '77777777-7777-7777-7777-777777777777',
   'U-other-shop', 'Salon Customer', 0),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   'U-demo-bob', 'Bob', 0);

-- Pin Alice's balance so the arithmetic below is deterministic no matter what
-- earlier manual sessions did to it.
update public.customers set points_balance = 50
where id = '55555555-5555-5555-5555-555555555555';

insert into public.point_grants (shop_id, staff_user_id, points, token, expires_at)
values
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
   5, 'tok-normal', now() + interval '5 minutes'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
   5, 'tok-expired', now() - interval '1 minute'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
   5, 'tok-cross-shop', now() + interval '5 minutes');

-- 1. The happy path: a valid grant credits its points through the ledger.
select is(
  (select balance from public.claim_point_grant('tok-normal', '55555555-5555-5555-5555-555555555555')),
  55,
  'claiming a valid grant credits the points'
);

-- 2. The ledger names the staff member who issued the QR, not "system" — this
-- is what makes the points auditable back to a person.
select is(
  (
    select staff_user_id from public.points_transactions
    where customer_id = '55555555-5555-5555-5555-555555555555'
    order by created_at desc limit 1
  ),
  '44444444-4444-4444-4444-444444444444'::uuid,
  'the ledger entry is attributed to the issuing staff member'
);

-- 3. THE load-bearing one: a claimed grant cannot be claimed again. The
-- customer app auto-claims on load, so their own repeat is idempotent rather
-- than an error — but it must not credit twice.
select is(
  (select balance from public.claim_point_grant('tok-normal', '55555555-5555-5555-5555-555555555555')),
  55,
  'the same customer re-claiming does not credit a second time'
);

-- 4. …and a *different* person arriving with the same (photographed) code is a
-- hard failure, not an idempotent replay.
select throws_ok(
  $$ select * from public.claim_point_grant('tok-normal', '66666666-6666-6666-6666-666666666666') $$,
  'P0001',
  'already claimed',
  'a second customer cannot claim an already-claimed grant'
);

-- 5. Expiry is enforced server-side, not just by the countdown in the UI.
select throws_ok(
  $$ select * from public.claim_point_grant('tok-expired', '55555555-5555-5555-5555-555555555555') $$,
  'P0001',
  'grant expired',
  'an expired grant cannot be claimed'
);

-- 6. Tenant isolation: another shop's customer cannot claim this shop's grant.
select throws_ok(
  $$ select * from public.claim_point_grant('tok-cross-shop', '99999999-9999-9999-9999-999999999999') $$,
  'P0001',
  'grant belongs to another shop',
  'a customer cannot claim a grant issued by a different shop'
);

-- 7. Postgres grants EXECUTE to PUBLIC by default, so 0012's explicit revokes
-- are what actually keep this out of reach of a plain anon/authenticated key.
-- Without them, points could be claimed with a guessed token and no card.
set local role authenticated;
select throws_ok(
  $$ select * from public.claim_point_grant('tok-cross-shop', '55555555-5555-5555-5555-555555555555') $$,
  '42501',
  'claim_point_grant is not executable by authenticated (service_role only)'
);
reset role;

select * from finish();
rollback;
