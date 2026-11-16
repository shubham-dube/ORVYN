import type { DeviceInfo, SessionResponse } from '@orvyn/contracts';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The access token lives only in memory; the refresh token is an HttpOnly cookie the page cannot read. */
let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
const listeners = new Set<(s: SessionResponse | null) => void>();

export const getAccessToken = () => accessToken;
export function onSession(fn: (s: SessionResponse | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setSession(s: SessionResponse | null): void {
  accessToken = s?.accessToken ?? null;
  for (const l of listeners) l(s);
}

/** One refresh at a time, however many requests hit a 401 together. */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const s = res.ok ? ((await res.json()) as SessionResponse) : null;
      setSession(s);
      return s;
    } catch {
      return null; // offline: keep the current state
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && auth && retry) {
    const s = await refreshSession();
    if (s) return api<T>(path, { ...opts, retry: false });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'error',
      e?.message ?? 'Something went wrong. Please try again.',
    );
  }
  return data as T;
}

export function thisDevice(): DeviceInfo {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  const standalone =
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
  return {
    name: `${standalone ? 'ORVYN app' : browser}${os ? ` on ${os}` : ''}`,
    platform: 'web',
    appVersion: '0.1.0',
  };
}
