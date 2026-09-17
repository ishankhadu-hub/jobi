/**
 * Auth context. Two backends, chosen by config (see config.ts):
 *   • Supabase  — when EXPO_PUBLIC_SUPABASE_URL/ANON_KEY are set. Real auth.
 *   • dev       — otherwise. Talks to the dev-orchestrator's /webhook/auth/*
 *                 so you can run the whole app with no Supabase.
 * Either way, the rest of the app just uses `token` (sent as Bearer) and never
 * sees a secret.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAuthToken } from './api';
import { config, useSupabaseAuth } from './config';

type User = { id: string; email?: string; full_name?: string } | null;
type Ctx = {
  ready: boolean;
  user: User;
  subscription: any;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
};

const AuthContext = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'jobi.token';
const USER_KEY = 'jobi.user';

// Lazily create a Supabase client only if configured (keeps the dep optional).
let _sb: any = null;
function supabase() {
  if (_sb) return _sb;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require('@supabase/supabase-js');
  _sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false }, // we persist the token ourselves
  });
  return _sb;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User>(null);
  const [subscription, setSubscription] = useState<any>(null);

  const applyToken = useCallback(async (token: string | null, u: User) => {
    setAuthToken(token);
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
      if (u) await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
    } else {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    }
    setUser(u);
  }, []);

  const refreshSubscription = useCallback(async () => {
    try {
      setSubscription(await api.subscription());
    } catch {
      /* non-fatal */
    }
  }, []);

  // Restore any saved session on startup.
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        const uStr = await AsyncStorage.getItem(USER_KEY);
        if (token) {
          setAuthToken(token);
          setUser(uStr ? JSON.parse(uStr) : null);
          await refreshSubscription();
        }
      } catch {
        /* ignore */
      } finally {
        setReady(true);
      }
    })();
  }, [refreshSubscription]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (useSupabaseAuth) {
      const { data, error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await applyToken(data.session?.access_token || null, { id: data.user?.id, email: data.user?.email });
    } else {
      const res: any = await api.login(email, password);
      await applyToken(res.token, res.user);
    }
    await refreshSubscription();
  }, [applyToken, refreshSubscription]);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    if (useSupabaseAuth) {
      const { data, error } = await supabase().auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw new Error(error.message);
      // If email confirmation is off (local dev), we get a session immediately.
      if (data.session) await applyToken(data.session.access_token, { id: data.user?.id, email });
      else {
        // Otherwise sign in to obtain a token.
        await signIn(email, password);
        return;
      }
    } else {
      const res: any = await api.signup(email, password, fullName);
      await applyToken(res.token, res.user);
    }
    await refreshSubscription();
  }, [applyToken, refreshSubscription, signIn]);

  const signOut = useCallback(async () => {
    if (useSupabaseAuth) {
      try { await supabase().auth.signOut(); } catch {}
    }
    await applyToken(null, null);
    setSubscription(null);
  }, [applyToken]);

  return (
    <AuthContext.Provider value={{ ready, user, subscription, signIn, signUp, signOut, refreshSubscription }}>
      {children}
    </AuthContext.Provider>
  );
}
