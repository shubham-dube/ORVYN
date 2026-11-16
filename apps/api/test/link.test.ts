import { type SessionResponse } from '@orvyn/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, device, type Harness, OWNER, signIn, startApp } from './harness';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
let h: Harness;
let owner: SessionResponse;

beforeAll(async () => {
  h = await startApp([], { EXTENSION_IDS: EXT });
  owner = (await signIn(h, OWNER, { platform: 'web' })).body;
});
afterAll(() => h.close());

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
const state = 'state-' + 'x'.repeat(20);

async function approve(redirectUri: string, challenge: string, token = owner.accessToken) {
  return call<{ redirect: string; client: string }>(h, 'POST', '/auth/link/start', {
    token,
    body: { challenge, redirectUri, state },
  });
}
const codeOf = (redirect: string) => new URL(redirect).searchParams.get('code')!;

describe('linking the desktop app and the extension', () => {
  it('desktop: approve on the web, redeem with the verifier → its own Windows device session', async () => {
    const { verifier, challenge } = pkce();
    const a = await approve('http://127.0.0.1:53682/callback', challenge);
    expect(a.status).toBe(200);
    expect(a.body.client).toBe('desktop');
    const back = new URL(a.body.redirect);
    expect(back.origin + back.pathname).toBe('http://127.0.0.1:53682/callback');
    expect(back.searchParams.get('state')).toBe(state);

    const r = await call<SessionResponse>(h, 'POST', '/auth/link/redeem', {
      body: { code: codeOf(a.body.redirect), verifier, device: device('windows', 'Work laptop') },
    });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).toBeTruthy(); // native client: token in the body, not a cookie
    expect(r.body.user.email).toBe(OWNER);
    const devices = await call<{ name: string; platform: string }[]>(h, 'GET', '/me/devices', {
      token: r.body.accessToken,
    });
    expect(devices.body.some((d) => d.name === 'Work laptop' && d.platform === 'windows')).toBe(true);
  });

  it('a code works once, and never without the right verifier', async () => {
    const { verifier, challenge } = pkce();
    const code = codeOf((await approve('http://127.0.0.1:5000/cb', challenge)).body.redirect);
    const wrong = await call(h, 'POST', '/auth/link/redeem', {
      body: { code, verifier: pkce().verifier, device: device('windows') },
    });
    expect(wrong.status).toBe(401);
    // the failed attempt burned it: even the right verifier is now refused
    const late = await call(h, 'POST', '/auth/link/redeem', {
      body: { code, verifier, device: device('windows') },
    });
    expect(late.status).toBe(401);
  });

  it('extension: only allowlisted extension ids, and the code only works for an extension device', async () => {
    const { verifier, challenge } = pkce();
    const bad = await approve('https://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.chromiumapp.org/', challenge);
    expect(bad.status).toBe(400);
    const ok = await approve(`https://${EXT}.chromiumapp.org/`, challenge);
    expect(ok.body.client).toBe('extension');
    const asWindows = await call(h, 'POST', '/auth/link/redeem', {
      body: { code: codeOf(ok.body.redirect), verifier, device: device('windows') },
    });
    expect(asWindows.status).toBe(403);

    const again = pkce();
    const ok2 = await approve(`https://${EXT}.chromiumapp.org/`, again.challenge);
    const r = await call<SessionResponse>(h, 'POST', '/auth/link/redeem', {
      body: {
        code: codeOf(ok2.body.redirect),
        verifier: again.verifier,
        device: device('extension', 'Chrome'),
      },
    });
    expect(r.status).toBe(200);
  });

  it('refuses redirects that could leak the code', async () => {
    const { challenge } = pkce();
    for (const uri of [
      'https://evil.example/cb',
      'http://localhost.evil.example/cb',
      'http://192.168.1.5:5000/cb',
      'http://user:pw@127.0.0.1:5000/cb',
      'javascript:alert(1)',
    ]) {
      expect((await approve(uri, challenge)).status, uri).toBe(400);
    }
  });

  it('approving needs a signed-in person', async () => {
    const { challenge } = pkce();
    const r = await call(h, 'POST', '/auth/link/start', {
      body: { challenge, redirectUri: 'http://127.0.0.1:5000/cb', state },
    });
    expect(r.status).toBe(401);
  });
});
