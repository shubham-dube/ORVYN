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

/** Upload a file's bytes (files module, ADR-0011); returns its id. Refreshes the session once on 401. */
export async function uploadFile(
  file: Blob & { name?: string },
  purpose: 'drop' | 'money' | 'library' | 'voice' | 'chat' | 'chat-file' | 'split' = 'drop',
): Promise<{ id: string; name: string }> {
  const send = () =>
    fetch(`${API_URL}/files`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name ?? 'file'),
        'x-file-purpose': purpose,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: file,
    });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  const data = (await res.json().catch(() => null)) as {
    id: string;
    name: string;
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'error',
      data?.error?.message ?? 'The upload failed.',
    );
  return data!;
}

/** An uploaded file's bytes (the server decrypts it for its owner), as a blob the page can open or save. */
export async function downloadFile(id: string): Promise<Blob> {
  const send = () =>
    fetch(`${API_URL}/files/${id}`, {
      credentials: 'include',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw new ApiError(res.status, 'error', 'The file couldn’t be opened.');
  return res.blob();
}
