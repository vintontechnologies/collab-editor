import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, tokens } from '../services/api';
import type { User } from '../types';

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // If we have a stored token, wait for /auth/me/ before deciding who is logged in
  const [loading, setLoading] = useState(Boolean(tokens.refresh));

  useEffect(() => {
    if (!tokens.refresh) return;
    api
      .get<User>('/auth/me/')
      .then((r) => setUser(r.data))
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  // The API client fires this event when a token refresh fails
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login/', { email, password });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      await api.post('/auth/register/', { name, email, password });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      // Blacklists the refresh token on the server so it can't be reused
      if (tokens.refresh) await api.post('/auth/logout/', { refresh: tokens.refresh });
    } catch {
      /* log out locally even if the server call fails */
    }
    tokens.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
