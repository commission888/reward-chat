-- Local development seed data: one demo shop, one user per role, two customers.
-- Password for all three seeded logins is "password123". Local dev only — never
-- run this against a production project.

insert into public.shops (id, name, slug, line_channel_id, line_channel_secret, line_channel_access_token, liff_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'Demo Coffee Shop',
  'demo-coffee',
  'demo-line-channel-id',
  'demo-line-channel-secret',
  'demo-line-channel-access-token',
  'demo-liff-id'
);

-- GoTrue scans confirmation_token/recovery_token/email_change_* into
-- non-nullable Go string fields — a NULL there (the default if omitted)
-- makes every subsequent password-grant login 500 with "converting NULL to
-- string is unsupported". Every one of those columns must be '' explicitly.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'superadmin@demo.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"super_admin","full_name":"Platform Super Admin"}',
   now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'admin@demo.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"admin","shop_id":"11111111-1111-1111-1111-111111111111","full_name":"Demo Shop Admin"}',
   now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'staff@demo.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"role":"staff","shop_id":"11111111-1111-1111-1111-111111111111","full_name":"Demo Shop Staff"}',
   now(), now(), '', '', '', '', '', '', '', '');

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  (extensions.gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"superadmin@demo.local"}', 'email', now(), now(), now()),
  (extensions.gen_random_uuid(), '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
   '{"sub":"33333333-3333-3333-3333-333333333333","email":"admin@demo.local"}', 'email', now(), now(), now()),
  (extensions.gen_random_uuid(), '44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444',
   '{"sub":"44444444-4444-4444-4444-444444444444","email":"staff@demo.local"}', 'email', now(), now(), now());

-- `handle_new_auth_user` trigger (0002 migration) creates the matching
-- `public.profiles` rows automatically from raw_user_meta_data above.

insert into public.customers (id, shop_id, line_user_id, display_name, points_balance)
values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'demo-line-user-1', 'Alice Customer', 50),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'demo-line-user-2', 'Bob Customer', 120);

insert into public.loyalty_cards (customer_id, shop_id, qr_token)
values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'demo-qr-token-alice'),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'demo-qr-token-bob');
