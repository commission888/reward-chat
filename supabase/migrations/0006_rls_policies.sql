-- Row Level Security for every tenant-scoped table.
--
-- IMPORTANT: every policy below reads role/shop via the security-definer
-- helpers defined in 0002 (`is_super_admin()`, `my_shop_id()`, `current_profile()`)
-- and NEVER via a direct subquery on `profiles`. A policy ON `profiles` that
-- subqueries `profiles` directly self-references and Postgres raises
-- 42P17 "infinite recursion detected in policy" the first time it runs.
--
-- Row-mutating RPCs (`apply_points`) and service-role Edge Functions
-- (create-staff-user, register-customer, apply-points, ingest-file,
-- line-webhook) run as security definer / service role and are not subject
-- to these policies — they perform their own authorization checks in code.

alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.points_transactions enable row level security;
alter table public.loyalty_cards enable row level security;
alter table public.files enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chat_logs enable row level security;

-- ---------------------------------------------------------------- shops --
create policy "shops: super_admin full access" on public.shops
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "shops: members can read own shop" on public.shops
  for select
  using (id = public.my_shop_id());

-- ------------------------------------------------------------- profiles --
create policy "profiles: super_admin full access" on public.profiles
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "profiles: self read" on public.profiles
  for select
  using (id = auth.uid());

create policy "profiles: admin reads own shop staff" on public.profiles
  for select
  using (shop_id = public.my_shop_id());

create policy "profiles: admin updates own shop staff" on public.profiles
  for update
  using (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  )
  with check (shop_id = public.my_shop_id());

-- ------------------------------------------------------------ customers --
create policy "customers: super_admin full access" on public.customers
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "customers: shop staff read" on public.customers
  for select
  using (shop_id = public.my_shop_id());

create policy "customers: shop admin/staff update" on public.customers
  for update
  using (shop_id = public.my_shop_id())
  with check (shop_id = public.my_shop_id());

-- ----------------------------------------------------- points_transactions --
create policy "points_transactions: super_admin full access" on public.points_transactions
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "points_transactions: shop staff read" on public.points_transactions
  for select
  using (shop_id = public.my_shop_id());

-- No client-side insert/update/delete policy: all writes go through the
-- `apply_points` security-definer RPC, which validates role/shop/balance
-- and bypasses RLS as its owning role.

-- ----------------------------------------------------------- loyalty_cards --
create policy "loyalty_cards: super_admin full access" on public.loyalty_cards
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "loyalty_cards: shop staff read" on public.loyalty_cards
  for select
  using (shop_id = public.my_shop_id());

-- --------------------------------------------------------------- files --
create policy "files: super_admin full access" on public.files
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "files: shop admin manage" on public.files
  for all
  using (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  )
  with check (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  );

-- ---------------------------------------------------------- document_chunks --
create policy "document_chunks: super_admin full access" on public.document_chunks
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "document_chunks: shop admin read" on public.document_chunks
  for select
  using (
    shop_id = public.my_shop_id()
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  );

-- -------------------------------------------------------------- chat_logs --
create policy "chat_logs: super_admin full access" on public.chat_logs
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "chat_logs: shop staff read" on public.chat_logs
  for select
  using (shop_id = public.my_shop_id());

-- --------------------------------------------------- storage: knowledge-files --
-- Path convention: {shop_id}/{file_id}/{filename}. Only that shop's admin
-- (or a super_admin) may read/write objects under their shop's folder.
create policy "knowledge-files: super_admin full access"
  on storage.objects for all
  using (bucket_id = 'knowledge-files' and public.is_super_admin())
  with check (bucket_id = 'knowledge-files' and public.is_super_admin());

create policy "knowledge-files: shop admin manage own folder"
  on storage.objects for all
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = public.my_shop_id()::text
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  )
  with check (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = public.my_shop_id()::text
    and exists (select 1 from public.current_profile() cp where cp.role = 'admin')
  );
