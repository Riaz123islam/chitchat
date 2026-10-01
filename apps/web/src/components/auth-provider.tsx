'use client';

// Auth state for email+password accounts (Supabase Auth). Guests simply
// never sign in — the context stays in its signed-out state.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase, isAuthEnabled } from '@/lib/supabase';

/** Email+password auth action. Returns an error message, or null on success. */
// eslint-disable-next-line no-unused-vars -- parameter names required by TS, only the type is used
type EmailPasswordAction = (email: string, password: string) => Promise<string | null>;

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  user: User | null;
  signUp: EmailPasswordAction;
  signIn: EmailPasswordAction;
  signOut: () => Promise<void>;
  /** Current access token for authenticated API/socket calls (null when signed out). */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  loading: true,
  user: null,
  signUp: async () => 'Auth is not configured.',
  signIn: async () => 'Auth is not configured.',
  signOut: async () => {},
  getAccessToken: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const enabled = isAuthEnabled();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return 'Auth is not configured.';
    const { error } = await supabase.auth.signUp({ email, password });
    return error ? error.message : null;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return 'Auth is not configured.';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const value = useMemo(
    () => ({ enabled, loading, user, signUp, signIn, signOut, getAccessToken }),
    [enabled, loading, user, signUp, signIn, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
