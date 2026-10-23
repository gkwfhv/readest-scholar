'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useEffect,
} from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import posthog from 'posthog-js';
import { transferManager } from '@/services/transferManager';
import { isTauriAppPlatform } from '@/services/environment';
import { loadNativeAiCredentials, withoutAiCredentials } from '@/services/ai/nativeCredentials';
import { useSettingsStore } from '@/store/settingsStore';
import { aiUserScope } from '@/services/ai/accountScope';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

let aiCredentialReloadVersion = 0;
function storedAccountId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null') as { id?: unknown } | null;
    return typeof user?.id === 'string' ? user.id : null;
  } catch {
    return null;
  }
}
function reloadNativeAiCredentials(userId: string | null): void {
  if (!isTauriAppPlatform()) return;
  const version = ++aiCredentialReloadVersion;
  const store = useSettingsStore.getState();
  if (!store.settings.aiSettings) return;
  // Clear the previous account synchronously, before publishing the new user.
  store.setSettings(withoutAiCredentials(store.settings));
  void loadNativeAiCredentials(userId)
    .then((credentials) => {
      if (version !== aiCredentialReloadVersion) return;
      const activeUser = JSON.parse(localStorage.getItem('user') || 'null') as { id?: string } | null;
      if ((activeUser?.id ?? null) !== userId) return;
      const current = useSettingsStore.getState();
      if (!current.settings.aiSettings) return;
      current.setSettings({
        ...current.settings,
        aiSettings: {
          ...current.settings.aiSettings,
          ...credentials,
          credentialScope: aiUserScope(userId),
        },
      });
    })
    .catch(() => {
      console.warn('AI credentials could not be loaded from the OS keychain');
    });
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  });
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    }
    return null;
  });

  useEffect(() => {
    const syncSession = (
      session: { access_token: string; refresh_token: string; user: User } | null,
    ) => {
      if (session) {
        console.log('Syncing session');
        const previousAccount = storedAccountId();
        const { access_token, refresh_token, user } = session;
        localStorage.setItem('token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        localStorage.setItem('user', JSON.stringify(user));
        if (previousAccount !== user.id) reloadNativeAiCredentials(user.id);
        posthog.identify(user.id);
        setToken(access_token);
        setUser(user);
        transferManager.setScholarAccountId(user.id);
      } else {
        const previousAccount = storedAccountId();
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        if (previousAccount !== null) reloadNativeAiCredentials(null);
        setToken(null);
        setUser(null);
        transferManager.setScholarAccountId(null);
      }
    };
    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      syncSession(session);
    });

    // onAuthStateChange emits INITIAL_SESSION and the SDK refreshes expiring
    // sessions under its own lock; forcing another rotation on mount races
    // with other reader windows.
    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  // setToken / setUser from useState are stable across renders, so the empty
  // deps array is correct. Wrapping in useCallback (and only including stable
  // refs in the deps) is what makes the useMemo below actually memoize the
  // context value — without this, login/logout/refresh would be recreated on
  // every render and the memo would always invalidate.
  const login = useCallback((newToken: string, newUser: User) => {
    console.log('Logging in');
    const previousAccount = storedAccountId();
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    if (previousAccount !== newUser.id) reloadNativeAiCredentials(newUser.id);
    transferManager.setScholarAccountId(newUser.id);
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out');
    const previousAccount = storedAccountId();
    try {
      await supabase.auth.refreshSession();
    } catch {
    } finally {
      await supabase.auth.signOut({ scope: 'local' });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (previousAccount !== null) reloadNativeAiCredentials(null);
      setToken(null);
      setUser(null);
      transferManager.setScholarAccountId(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
