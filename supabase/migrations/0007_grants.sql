-- Table/function-level privileges.
--
-- RLS policies (0006) restrict *which rows* a Postgres role may touch; these
-- GRANTs are what allow the operation at all. Supabase does not grant
-- SELECT/INSERT/UPDATE/DELETE by default for tables created via CLI
-- migrations (only TRIGGER/REFERENCES/TRUNCATE come from the base template),
-- so every application table needs an explicit grant here. `service_role`
-- bypasses RLS but still needs these object-level privileges.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.shops to authenticated, service_role;

-- `profiles.role`/`profiles.shop_id` must NEVER be directly client-writable:
-- a blanket UPDATE grant here would let any admin JWT PATCH their own or a
-- staff member's `role` to 'admin'/'super_admin' via PostgREST directly,
-- bypassing the fact that the only sanctioned way to grant a role is the
-- `create-staff-user` edge function (which forces shop_id and validates the
-- caller's own role server-side). Only `full_name` is safe to self-serve.
-- Row-level scoping (which profiles) still comes from the RLS policies in
-- 0006; this GRANT is what additionally locks down which *columns*.
grant select, insert, delete on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- `customers.points_balance` must NEVER be directly client-writable: it's a
-- cache whose only legitimate writer is the `apply_points` RPC (security
-- definer, runs as table owner, unaffected by these grants). Granting a
-- blanket UPDATE here would let any staff/admin JWT PATCH the balance via
-- PostgREST directly, bypassing the points_transactions ledger entirely.
grant select, insert, delete on public.customers to authenticated;
grant update (display_name, picture_url, phone) on public.customers to authenticated;
grant select, insert, update, delete on public.customers to service_role;

-- No policy grants client-side insert/update/delete on points_transactions
-- (see 0006), so this SELECT-only intent for `authenticated` is enforced by
-- RLS even though the GRANT below is broader for service_role's benefit.
grant select on public.points_transactions to authenticated;
grant select, insert, update, delete on public.points_transactions to service_role;
grant select, insert, update, delete on public.loyalty_cards to authenticated, service_role;
grant select, insert, update, delete on public.files to authenticated, service_role;
grant select, insert, update, delete on public.document_chunks to authenticated, service_role;
grant select, insert, update, delete on public.chat_logs to authenticated, service_role;

grant execute on function public.current_profile() to authenticated, service_role;
grant execute on function public.is_super_admin() to authenticated, service_role;
grant execute on function public.my_shop_id() to authenticated, service_role;
grant execute on function public.apply_points(uuid, integer, text) to authenticated, service_role;
grant execute on function public.match_document_chunks(uuid, extensions.vector, integer) to authenticated, service_role;
