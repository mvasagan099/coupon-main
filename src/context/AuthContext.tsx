/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, ensureUserProfile, getCompanyByOwner, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isMerchant: boolean;
  isLoading: boolean;
  authError: string | null;
  signOut: () => Promise<void>;
}
async function timed<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Session verification timed out. Please retry.')), 10000);
    })]);
  } finally { clearTimeout(timer!); }
}
const AuthContext = createContext<AuthContextType>({ user: null, session: null, isAdmin: false,
  isMerchant: false, isLoading: true, authError: null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isMerchant, setIsMerchant] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    const applySession = async (candidate: Session | null, current: number) => {
      try {
        if (!candidate || !isSupabaseConfigured) {
          if (!disposed && current === revision) { setUser(null); setSession(null); setIsMerchant(false); setAuthError(null); }
          return;
        }
        const { data, error } = await timed(supabase.auth.getUser(candidate.access_token));
        if (error || !data.user || data.user.is_anonymous) throw new Error('Please sign in again.');
        const { data: active, error: lockError } = await timed(supabase.rpc('is_account_active', { p_user_id: data.user.id }));
        if (lockError) throw new Error('Account access could not be verified. Please retry.');
        if (!active) throw new Error('This account is locked. Contact support.');
        await timed(ensureUserProfile(data.user.id));
        const company = await timed(getCompanyByOwner(data.user.id));
        if (!disposed && current === revision) {
          setUser(data.user); setSession(candidate); setIsMerchant(!!company); setAuthError(null);
        }
      } catch (error) {
        if (!disposed && current === revision) {
          setUser(null); setSession(null); setIsMerchant(false);
          setAuthError(error instanceof Error ? error.message : 'Session verification failed.');
        }
      } finally {
        if (!disposed && current === revision) setIsLoading(false);
      }
    };
    const schedule = (candidate: Session | null) => {
      const current = ++revision;
      setIsLoading(true);
      clearTimeout(timer);
      // Leave the auth callback before making any asynchronous Supabase calls.
      timer = setTimeout(() => { void applySession(candidate, current); }, 0);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, candidate) => schedule(candidate));
    void supabase.auth.getSession().then(({ data }) => {
      if (!revision) schedule(data.session);
    }).catch(() => schedule(null));
    return () => { disposed = true; revision++; clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error('Sign out failed. Please retry.');
    setUser(null); setSession(null); setIsMerchant(false); setAuthError(null);
  };
  return <AuthContext.Provider value={{ user, session, isAdmin: user?.app_metadata?.role === 'admin',
    isMerchant, isLoading, authError, signOut }}>{children}</AuthContext.Provider>;
}
