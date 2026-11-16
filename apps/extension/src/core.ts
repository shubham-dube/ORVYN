import type { Me, NotificationView, SessionResponse } from '@orvyn/contracts';

/** chrome.storage.local in the extension; a Map in tests. Holds only the refresh token and cached profile. */
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string | undefined): Promise<void>;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function pkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { verifier, challenge, state };
}

export function connectUrl(webUrl: string, redirectUri: string, challenge: string, state: string): string {
  const u = new URL('/connect', webUrl);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('state', state);
  return u.toString();
}

/** The code from the redirect — only if it carries the state we sent (no injected codes). */
export function codeFromCallback(callbackUrl: string, expectedState: string): string {
  const u = new URL(callbackUrl);
  if (u.searchParams.get('state') !== expectedState) throw new Error('state_mismatch');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('no_code');
  return code;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type Fetch = typeof fetch;

/**
 * The extension's API client: access token in memory, refresh token in extension storage (never visible to web
 * pages), single-flight refresh, one replay after a 401. A refused refresh ends the session here.
 */
export class Client {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  onSignedOut: () => void = () => undefined;

  constructor(
    readonly apiUrl: string,
    private readonly store: Store,
    private readonly fetchFn: Fetch = (...a) => fetch(...a),
  ) {}

  get accessToken(): string | null {
    return this.access;
  }

  async isConnected(): Promise<boolean> {
    return (await this.store.get('refresh')) !== undefined;
  }

  async me(): Promise<Me | null> {
    const raw = await this.store.get('me');
    return raw ? (JSON.parse(raw) as Me) : null;
  }

  async adopt(s: SessionResponse): Promise<void> {
    this.access = s.accessToken;
    await this.store.set('refresh', s.refreshToken);
    await this.store.set('me', JSON.stringify(s.user));
  }

  async redeem(code: string, verifier: string, deviceName: string, version: string): Promise<Me> {
    const r = await this.fetchFn(`${this.apiUrl}/auth/link/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        verifier,
        device: { name: deviceName, platform: 'extension', appVersion: version },
      }),
    });
    if (!r.ok) throw new ApiError(r.status, await errorCode(r));
    const s = (await r.json()) as SessionResponse;
    await this.adopt(s);
    return s.user;
  }

  refresh(): Promise<boolean> {
    return (this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null)));
  }

  private async doRefresh(): Promise<boolean> {
    const token = await this.store.get('refresh');
    if (!token) return false;
    let r: Response;
    try {
      r = await this.fetchFn(`${this.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
    } catch {
      return false; // offline: keep the token
    }
    if (r.ok) {
      await this.adopt((await r.json()) as SessionResponse);
      return true;
    }
    if (r.status === 401 || r.status === 403) await this.forget();
    return false;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.access) await this.refresh();
    const send = () =>
      this.fetchFn(`${this.apiUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.access ? { authorization: `Bearer ${this.access}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let r = await send();
    if (r.status === 401 && (await this.refresh())) r = await send();
    if (!r.ok) throw new ApiError(r.status, await errorCode(r));
    const text = await r.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async signOut(): Promise<void> {
    try {
      await this.call('POST', '/auth/sign-out');
    } catch {
      // offline or already revoked: forget locally regardless
    }
    await this.forget();
  }

  async forget(): Promise<void> {
    const had = await this.isConnected();
    this.access = null;
    await this.store.set('refresh', undefined);
    await this.store.set('me', undefined);
    if (had) this.onSignedOut();
  }
}

async function errorCode(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: { code?: string } };
    return j.error?.code ?? `http_${r.status}`;
  } catch {
    return `http_${r.status}`;
  }
}

/** Badge text: nothing at zero, "9+" past nine. */
export const badgeText = (unread: number) => (unread <= 0 ? '' : unread > 9 ? '9+' : String(unread));

export const unreadCount = (items: NotificationView[]) => items.filter((n) => !n.readAt).length;

/** Messages between the popup and the background worker. */
export type Request =
  | { type: 'status' }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'dismiss'; id: string }
  | { type: 'test' };

export interface Status {
  connected: boolean;
  me: Me | null;
  live: boolean;
  notifications: NotificationView[];
  error?: string;
}
