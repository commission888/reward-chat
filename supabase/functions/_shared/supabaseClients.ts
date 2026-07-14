import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Respects the caller's RLS — pass through the incoming Authorization header
// so auth.uid() / RLS policies see the real caller, not the service role.
export function createCallerClient(authHeader: string | null) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader ?? "" } },
  });
}

// Bypasses RLS entirely. Only use after this function has done its own
// authorization checks — never expose this client's results directly based
// on an unchecked caller claim.
export function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
