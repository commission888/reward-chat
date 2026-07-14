-- Same PUBLIC-default over-grant as 0009, on match_document_chunks. 0007
-- intended `grant execute ... to authenticated, service_role`, but Postgres'
-- default PUBLIC grant silently also exposed it to `anon`. This function is
-- SECURITY DEFINER (bypasses RLS) and takes an arbitrary p_shop_id, so an anon
-- caller holding the public LIFF anon key could POST to
-- /rest/v1/rpc/match_document_chunks with any shop_id and a throwaway
-- embedding and read back that shop's entire knowledge base — a cross-tenant
-- read leak. Revoke the PUBLIC default so only the intended explicit grants
-- (authenticated, service_role) remain.
revoke execute on function public.match_document_chunks(uuid, extensions.vector, integer) from public;
revoke execute on function public.match_document_chunks(uuid, extensions.vector, integer) from anon;
