// Supabase Auth JWT verification (email+password accounts).
// Plain fetch against the Supabase Auth API — no heavy client library.
// When Supabase Auth is not configured, every verification returns null and
// the app keeps running with guest sessions only.

import { config } from './config.js';

export interface VerifiedUser {
  id: string;
  email?: string;
}

/**
 * Validate a Supabase access token and return the user it belongs to.
 * Returns null when the token is missing, invalid, expired, or when
 * Supabase Auth is not configured.
 */
export async function verifySupabaseToken(token: unknown): Promise<VerifiedUser | null> {  if (typeof token !== 'string' || token.length === 0 || token.length > 8192) return null;
  if (!config.useSupabaseAuth) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: unknown; email?: unknown };
    if (typeof data.id !== 'string' || data.id.length === 0) return null;
    return {
      id: data.id,
      email: typeof data.email === 'string' ? data.email : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Permanently delete a Supabase auth user (admin API, service-role key).
 * Used for account self-deletion. Returns false when Supabase is not
 * configured or the request fails.
 */
export async function deleteAuthUser(userId: string): Promise<boolean> {
  if (!config.useSupabase || typeof userId !== 'string' || userId.length === 0) return false;
  try {
    const res = await fetch(
      `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: config.supabaseServiceKey,
          Authorization: `Bearer ${config.supabaseServiceKey}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
