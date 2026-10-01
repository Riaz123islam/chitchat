// Supabase browser client for email+password auth. Only created when the
// public env vars are set; every caller must handle a null client (auth UI
// hidden, guest mode still works).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    client = null;
    return null;
  }
  client = createClient(url, anonKey);
  return client;
}

/** True when signup/login is available in this deployment. */
export function isAuthEnabled(): boolean {
  return getSupabase() !== null;
}
