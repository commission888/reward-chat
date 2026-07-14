-- Regression tests for the invariants this schema depends on. Run with:
--   supabase test db
-- (requires pgTAP; supabase local dev images ship with it preinstalled)
--
-- Self-contained: creates its own second shop/admin fixture (in addition to
-- the seeded Demo Coffee Shop) so this test doesn't depend on `seed.sql`
-- contents, and everything is rolled back at the end.

begin;
select plan(7);

-- Fixture: a second shop + admin, to test cross-tenant isolation against the
-- seeded "Demo Coffee Shop" (11111111-…) / "staff@demo.local" (44444444-…) /
-- customer Alice (55555555-…, seeded with points_balance = 50).
insert into public.shops (id, name, slug)
values ('77777777-7777-7777-7777-777777777777', 'Test Salon', 'test-salon');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '88888888-8888-8888-8888-888888888888',
  'authenticated', 'authenticated', 'salonadmin@test.local',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"role":"admin","shop_id":"77777777-7777-7777-7777-777777777777","full_name":"Test Salon Admin"}',
  now(), now()
);

-- Pin Alice's balance to a known baseline so test 3 is deterministic
-- regardless of what earlier manual/test sessions did to it.
update public.customers set points_balance = 50 where id = '55555555-5555-5555-5555-555555555555';

-- 1. RLS on `profiles` must not recurse (42P17) when a shop member queries it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select lives_ok(
  $$ select role from public.profiles $$,
  'profiles select does not recurse (42P17) via security-definer helpers'
);

-- 2. Cross-tenant isolation: the salon admin must see zero coffee-shop customers.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}', true);
select is(
  (select count(*) from public.customers)::int,
  0,
  'a shop admin sees zero customers belonging to a different shop'
);

-- 3. apply_points: happy path increments balance by exactly `delta` and writes a ledger row.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is(
  public.apply_points('55555555-5555-5555-5555-555555555555', 10, 'purchase'),
  60,
  'apply_points increments balance from the pinned baseline of 50 to 60'
);

-- 4. apply_points: rejects a delta that would drive the balance negative.
select throws_ok(
  $$ select public.apply_points('55555555-5555-5555-5555-555555555555', -1000000, 'redeem') $$,
  'insufficient balance'
);

-- 5. apply_points: rejects cross-shop tampering (salon admin on a coffee-shop customer).
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}', true);
select throws_ok(
  $$ select public.apply_points('55555555-5555-5555-5555-555555555555', 10, 'cross-shop') $$,
  'customer does not belong to caller shop'
);

-- 6. The ledger cannot be bypassed by writing points_balance directly (no
-- client-facing grant on that column — see 0007_grants.sql).
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select throws_ok(
  $$ update public.customers set points_balance = 99999 where id = '55555555-5555-5555-5555-555555555555' $$,
  'permission denied for table customers'
);

-- 7. An admin cannot self-service promote a staff member's role via direct
-- table UPDATE (profiles.role is not in the column-scoped GRANT — see
-- 0007_grants.sql). The only sanctioned path is create-staff-user.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
-- staff@demo.local promoting themselves to admin must fail
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '44444444-4444-4444-4444-444444444444' $$,
  'permission denied for table profiles'
);

select * from finish();
rollback;
