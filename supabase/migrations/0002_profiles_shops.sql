-- Shops (tenants) and staff/admin/super_admin profiles.

create table public.shops (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Bangkok',
  line_channel_id text,
  line_channel_secret text,
  line_channel_access_token text,
  liff_id text,
  points_config jsonb not null default '{"points_per_baht": 1}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  role text not null check (role in ('super_admin', 'admin', 'staff')),
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  constraint profiles_shop_role_check check (
    (role = 'super_admin' and shop_id is null) or
    (role in ('admin', 'staff') and shop_id is not null)
  )
);

create index profiles_shop_id_idx on public.profiles (shop_id);

-- Security-definer lookup helpers. All RLS policies must call these instead of
-- subquerying `profiles` directly, or policies ON `profiles` itself will recurse
-- (Postgres error 42P17 "infinite recursion detected in policy").
create or replace function public.current_profile()
returns table (role text, shop_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select role, shop_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function public.my_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select shop_id from public.profiles where id = auth.uid();
$$;

-- Auto-provision a `profiles` row when a new auth.users row is created via
-- supabase.auth.admin.createUser(..., { data: { role, shop_id, full_name } }).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'role' is not null then
    insert into public.profiles (id, shop_id, role, full_name, email)
    values (
      new.id,
      nullif(new.raw_user_meta_data ->> 'shop_id', '')::uuid,
      new.raw_user_meta_data ->> 'role',
      new.raw_user_meta_data ->> 'full_name',
      new.email
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
