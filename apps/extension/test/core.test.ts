import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { badgeText, Client, codeFromCallback, connectUrl, pkce, type Store } from '../src/core';

const mem = (): Store & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k) => m.get(k),
    set: async (k, v) => void (v === undefined ? m.delete(k) : m.set(k, v)),
  };
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const session = (access: string, refresh: string) => ({
  accessToken: access,
  expiresIn: 900,
  refreshToken: refresh,
  deviceId: '00000000-0000-4000-8000-000000000001',
  user: {
    id: 'u',
    email: 'a@example.test',
    name: 'A',
    avatarUrl: null,
    role: 'member',
    entitlements: [],
    hasPasskey: false,
  },
});

describe('connecting', () => {
  it('PKCE challenge is the SHA-256 of the verifier, as the API checks', async () => {
    const p = await pkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
    expect(p.state.length).toBeGreaterThanOrEqual(16);
  });

  it('the connect URL carries redirect, challenge and state', () => {
    const u = new URL(
      connectUrl('https://orvyn.dubey.app', 'https://abc.chromiumapp.org/connected', 'C', 'S'),
    );
    expect(u.pathname).toBe('/connect');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      redirect_uri: 'https://abc.chromiumapp.org/connected',
      code_challenge: 'C',
      state: 'S',
    });
  });

  it('a callback with another state is refused (no injected codes)', () => {
    expect(codeFromCallback('https://x.chromiumapp.org/connected?code=abc&state=S1', 'S1')).toBe('abc');
    expect(() => codeFromCallback('https://x.chromiumapp.org/connected?code=abc&state=EVIL', 'S1')).toThrow(
      'state_mismatch',
    );
    expect(() => codeFromCallback('https://x.chromiumapp.org/connected?state=S1', 'S1')).toThrow('no_code');
  });
});

describe('the API client', () => {
  it('redeems a code as an extension device and keeps only the refresh token + profile', async () => {
    const store = mem();
    let sent: Record<string, unknown> = {};
    const c = new Client('http://api', store, async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return json(200, session('a1', 'r1'));
    });
    const me = await c.redeem('code', 'verifier', 'ORVYN for Chrome', '0.1.0');
    expect(me.email).toBe('a@example.test');
    expect((sent.device as { platform: string }).platform).toBe('extension');
    expect([...store.m.keys()].sort()).toEqual(['me', 'refresh']);
    expect(store.m.get('refresh')).toBe('r1');
  });

  it('five requests that hit 401 together refresh once, then replay', async () => {
    const store = mem();
    await store.set('refresh', 'r0');
    let refreshes = 0;
    const c = new Client('http://api', store, async (url, init) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshes++;
        return json(200, session('fresh', 'r1'));
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer fresh'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'token_expired' } });
    });
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => c.call<{ ok: boolean }>('GET', '/me')));
    expect(out.every((o) => o.ok)).toBe(true);
    expect(refreshes).toBe(1);
    expect(store.m.get('refresh')).toBe('r1');
  });

  it('a refused refresh disconnects and tells the worker', async () => {
    const store = mem();
    await store.set('refresh', 'stolen');
    await store.set('me', '{}');
    const c = new Client('http://api', store, async () => json(401, { error: { code: 'session_revoked' } }));
    let signedOut = false;
    c.onSignedOut = () => (signedOut = true);
    await expect(c.call('GET', '/notifications')).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toBe(true);
    expect(await c.isConnected()).toBe(false);
    expect(store.m.size).toBe(0);
  });

  it('offline refresh keeps the token for later', async () => {
    const store = mem();
    await store.set('refresh', 'r0');
    const c = new Client('http://api', store, async () => {
      throw new TypeError('network down');
    });
    expect(await c.refresh()).toBe(false);
    expect(store.m.get('refresh')).toBe('r0');
  });
});

it('badge shows nothing at zero and caps at 9+', () => {
  expect([badgeText(0), badgeText(3), badgeText(12)]).toEqual(['', '3', '9+']);
});
