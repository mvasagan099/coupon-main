/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, ensureUserProfile, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isAdmin: false,
  isLoading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Safety timeout: guarantee the UI unblocks even if auth never resolves
    const safetyTimer = setTimeout(() => {
      setIsLoading(false);
    }, 10000);

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsAdmin(session?.user?.app_metadata?.role === 'admin');
      if (session?.user?.id) {
        try { await ensureUserProfile(session.user.id); } catch { /* non-critical */ }
      }
      setIsLoading(false);
      clearTimeout(safetyTimer);
    }).catch(() => {
      // If getSession itself fails (e.g. misconfigured URL), still unblock the UI
      setIsLoading(false);
      clearTimeout(safetyTimer);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsAdmin(session?.user?.app_metadata?.role === 'admin');
      if (session?.user?.id) {
        try { await ensureUserProfile(session.user.id); } catch { /* non-critical */ }
      }
      setIsLoading(false);
      clearTimeout(safetyTimer);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
    };
  }, []);

  const signOut = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch {
      console.warn("Native signout failed, forcing local cleanup");
    } finally {
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      
      // Force clear any lingering Supabase tokens to prevent redirect loops
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          localStorage.removeItem(key);
        }
      });
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
