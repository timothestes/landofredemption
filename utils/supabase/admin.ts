import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-only code with no user session to run RLS
 * against (cron routes, scripts). Bypasses RLS entirely — never expose this
 * to a request path a browser can reach.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
