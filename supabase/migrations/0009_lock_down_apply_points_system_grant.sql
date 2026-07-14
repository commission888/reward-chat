-- Security fix: Postgres grants EXECUTE to PUBLIC by default on every newly
-- created function, so the `grant execute ... to service_role` in 0008 did NOT
-- actually restrict apply_points_system to service_role — PUBLIC (and thus the
-- `anon` and `authenticated` roles PostgREST exposes) could still call it via
-- /rest/v1/rpc/apply_points_system. Because apply_points_system has no
-- caller-role check by design (its trust boundary is "only service_role can
-- reach it"), a public anon key — which ships in the customer LIFF app — could
-- mint unlimited points to any customer. Revoke the default PUBLIC grant so the
-- only remaining EXECUTE privilege is the explicit one to service_role.
revoke execute on function public.apply_points_system(uuid, integer, text) from public;
revoke execute on function public.apply_points_system(uuid, integer, text) from anon;
revoke execute on function public.apply_points_system(uuid, integer, text) from authenticated;
