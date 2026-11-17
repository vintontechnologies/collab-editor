import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';

// Tokens live in localStorage for simplicity. (A production app might prefer
// httpOnly cookies, which are safer against XSS. Worth mentioning in your report.)
export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS);
  },
  get refresh() {
    return localStorage.getItem(REFRESH);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS, access);
    if (refresh) localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

export const api = axios.create({ baseURL: '/api' });

// Attach the access token to every request
api.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const NO_REFRESH = ['/auth/login/', '/auth/register/', '/auth/refresh/'];
let refreshing: Promise<string> | null = null;

// On a 401, get a new access token with the refresh token and retry the request once.
// Parallel requests share one refresh call.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as
      (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const skip = !original || NO_REFRESH.some((p) => original.url?.includes(p));

    if (error.response?.status === 401 && original && !skip && !original._retry && tokens.refresh) {
      original._retry = true;
      try {
        refreshing ??= axios
          .post('/api/auth/refresh/', { refresh: tokens.refresh })
          .then((r) => {
            tokens.set(r.data.access, r.data.refresh);
            return r.data.access as string;
          })
          .finally(() => {
            refreshing = null;
          });
        const access = await refreshing;
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        tokens.clear();
        window.dispatchEvent(new Event('auth:logout'));
      }
    }
    return Promise.reject(error);
  },
);

// Turn a DRF error response into one readable message
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === 'object') {
      const first = Object.values(data)[0];
      if (Array.isArray(first)) return String(first[0]);
      if (typeof first === 'string') return first;
    }
  }
  return 'Something went wrong. Please try again.';
}
