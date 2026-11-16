import { type SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, device, type Harness, OWNER, signIn, startApp } from './harness';
import { SoftAuthenticator } from './soft-authenticator';

let h: Harness;
let owner: SessionResponse;
const authenticator = new SoftAuthenticator('http://localhost:3000', 'localhost');

beforeAll(async () => {
  h = await startApp();
  owner = (await signIn(h, OWNER)).body;
});
afterAll(async () => h.close());

describe('passkeys', () => {
  it('adds a passkey to the signed-in account', async () => {
    const opts = await call<any>(h, 'POST', '/me/passkeys/options', { token: owner.accessToken });
    expect(opts.body.rp).toMatchObject({ id: 'localhost', name: 'ORVYN' });
    expect(opts.body.authenticatorSelection.residentKey).toBe('required');
    const res = await call(h, 'POST', '/me/passkeys', {
      token: owner.accessToken,
      body: { response: authenticator.register(opts.body), name: 'Pixel' },
    });
    expect(res.status).toBe(201);
    const me = await call(h, 'GET', '/me', { token: owner.accessToken });
    expect(me.body.hasPasskey).toBe(true);
  });

  it('signs in with the passkey, no email or password', async () => {
    const o = await call<any>(h, 'POST', '/auth/passkey/options');
    const r = await call<SessionResponse>(h, 'POST', '/auth/passkey/verify', {
      body: {
        challengeId: o.body.challengeId,
        response: authenticator.authenticate(o.body.options),
        device: device('windows'),
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(owner.user.id);
  });

  it('rejects a replayed challenge', async () => {
    const o = await call<any>(h, 'POST', '/auth/passkey/options');
    const response = authenticator.authenticate(o.body.options);
    const first = await call(h, 'POST', '/auth/passkey/verify', {
      body: { challengeId: o.body.challengeId, response, device: device() },
    });
    const replay = await call(h, 'POST', '/auth/passkey/verify', {
      body: { challengeId: o.body.challengeId, response, device: device() },
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(400);
  });

  it('rejects a signature from another key', async () => {
    const o = await call<any>(h, 'POST', '/auth/passkey/options');
    const impostor = new SoftAuthenticator('http://localhost:3000', 'localhost');
    const forged = impostor.authenticate(o.body.options);
    forged.id = forged.rawId = authenticator.credentialId.toString('base64url'); // claims to be the real credential
    const r = await call(h, 'POST', '/auth/passkey/verify', {
      body: { challengeId: o.body.challengeId, response: forged, device: device() },
    });
    expect(r.status).toBe(401);
  });

  it('rejects a response made for another website', async () => {
    const o = await call<any>(h, 'POST', '/auth/passkey/options');
    const phish = new SoftAuthenticator('https://orvyn-login.example', 'localhost');
    (phish as unknown as { credentialId: Buffer }).credentialId.set(authenticator.credentialId);
    const r = await call(h, 'POST', '/auth/passkey/verify', {
      body: {
        challengeId: o.body.challengeId,
        response: phish.authenticate(o.body.options),
        device: device(),
      },
    });
    expect(r.status).toBe(401);
  });
});
