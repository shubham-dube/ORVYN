import { Controller, Get, Module } from '@nestjs/common';
import { type SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequireEntitlement } from '../src/modules/auth/auth.decorators';
import { call, device, type Harness, OWNER, signIn, startApp } from './harness';

@Controller('test-money')
class MoneyProbe {
  @RequireEntitlement('money')
  @Get()
  ok() {
    return { ok: true };
  }
}
@Module({ controllers: [MoneyProbe] })
class ProbeModule {}

let h: Harness;
let owner: SessionResponse;

beforeAll(async () => {
  h = await startApp([ProbeModule]);
  const r = await signIn(h, OWNER);
  expect(r.status).toBe(200);
  owner = r.body;
});
afterAll(async () => h.close());

describe('health', () => {
  it('reports db and redis', async () => {
    const r = await call(h, 'GET', '/health');
    expect(r.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });
});

describe('owner bootstrap', () => {
  it('the owner email becomes the owner with every feature', async () => {
    expect(owner.user.role).toBe('owner');
    expect(owner.user.entitlements).toEqual(expect.arrayContaining(['today', 'money', 'vault', 'admin']));
    expect(owner.refreshToken).toBeTruthy(); // native client gets it in the body
    const me = await call(h, 'GET', '/me', { token: owner.accessToken });
    expect(me.body.email).toBe(OWNER);
  });

  it('a second sign-in reuses the account and adds a device', async () => {
    const again = await signIn(h, OWNER, { platform: 'windows' });
    expect(again.body.user.id).toBe(owner.user.id);
    const devices = await call<any[]>(h, 'GET', '/me/devices', { token: owner.accessToken });
    expect(devices.body.length).toBe(2);
    expect(devices.body.filter((d) => d.current).length).toBe(1);
  });
});

describe('closed registration', () => {
  it('strangers get the same answer but no code, and cannot sign in', async () => {
    const r = await call(h, 'POST', '/auth/email/start', { body: { email: 'stranger@example.test' } });
    expect(r.body).toEqual({ sent: true });
    expect((await call(h, 'GET', '/dev/mailbox?email=stranger@example.test')).status).toBe(404);
    const v = await call(h, 'POST', '/auth/email/verify', {
      body: { email: 'stranger@example.test', code: '123456', device: device() },
    });
    expect(v.status).toBe(401);
    expect(v.body.error.code).toBe('invalid_code');
  });

  it('friends join with an invite and get exactly the invited features', async () => {
    const inv = await call(h, 'POST', '/admin/invites', {
      token: owner.accessToken,
      body: { entitlements: ['today'], note: 'Aman' },
    });
    expect(inv.status).toBe(201);
    const token = inv.body.link.split('/join/')[1];
    expect((await call(h, 'GET', `/invites/${token}`)).body).toMatchObject({ valid: true });
    const friend = await signIn(h, 'aman@example.test', { invite: token });
    expect(friend.status).toBe(200);
    expect(friend.body.user).toMatchObject({ role: 'member', entitlements: ['today'] });
    // single use
    expect((await call(h, 'GET', `/invites/${token}`)).body).toEqual({ valid: false });
    const other = await call(h, 'POST', '/auth/email/start', {
      body: { email: 'other@example.test', invite: token },
    });
    expect(other.status).toBe(200);
    expect((await call(h, 'GET', '/dev/mailbox?email=other@example.test')).status).toBe(404);
  });

  it('an invite addressed to one email cannot be used by another', async () => {
    const inv = await call(h, 'POST', '/admin/invites', {
      token: owner.accessToken,
      body: { email: 'priya@example.test', entitlements: ['money'] },
    });
    const token = inv.body.link.split('/join/')[1];
    await call(h, 'POST', '/auth/email/start', { body: { email: 'mallory@example.test', invite: token } });
    expect((await call(h, 'GET', '/dev/mailbox?email=mallory@example.test')).status).toBe(404);
    const priya = await signIn(h, 'priya@example.test', { invite: token });
    expect(priya.body.user.entitlements).toEqual(['money']);
  });
});

describe('feature switches are enforced by the server', () => {
  it('members cannot reach features or the admin console they were not given', async () => {
    const friend = (await signIn(h, 'aman@example.test')).body;
    expect((await call(h, 'GET', '/test-money', { token: friend.accessToken })).status).toBe(403);
    expect((await call(h, 'GET', '/test-money', { token: owner.accessToken })).status).toBe(200);
    expect((await call(h, 'GET', '/admin/users', { token: friend.accessToken })).status).toBe(403);
  });

  it('granting a feature takes effect immediately', async () => {
    const friend = (await signIn(h, 'aman@example.test')).body;
    const set = await call(h, 'PUT', `/admin/users/${friend.user.id}/entitlements`, {
      token: owner.accessToken,
      body: { entitlements: ['today', 'money', 'admin'] },
    });
    expect(set.body.entitlements).toEqual(['today', 'money']); // admin can never be granted
    expect((await call(h, 'GET', '/test-money', { token: friend.accessToken })).status).toBe(200);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and treats reuse as theft', async () => {
    const s = (await signIn(h, OWNER, { platform: 'android' })).body;
    const r1 = await call<SessionResponse>(h, 'POST', '/auth/refresh', {
      body: { refreshToken: s.refreshToken },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    // the answer was lost on the way: asked again with the old token, once, while the new one is unused
    const again = await call<SessionResponse>(h, 'POST', '/auth/refresh', {
      body: { refreshToken: s.refreshToken },
    });
    expect(again.status).toBe(200);
    // (the lost one never reached the device, so it is never presented)
    const t2 = await call<SessionResponse>(h, 'POST', '/auth/refresh', {
      body: { refreshToken: again.body.refreshToken },
    });
    expect(t2.status).toBe(200);
    // that was the only time: the old token presented again after the new one was used → the device is revoked
    const reuse = await call(h, 'POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('session_revoked');
    expect(
      (await call(h, 'POST', '/auth/refresh', { body: { refreshToken: t2.body.refreshToken } })).status,
    ).toBe(401);
    expect((await call(h, 'GET', '/me', { token: t2.body.accessToken })).status).toBe(401);
    const audit = await call<any[]>(h, 'GET', '/admin/audit', { token: owner.accessToken });
    expect(audit.body.some((a) => a.action === 'auth.refresh_reuse')).toBe(true);
  });

  it('web gets an HttpOnly cookie instead of a token in the body', async () => {
    const s = await signIn(h, OWNER, { platform: 'web' });
    expect(s.body.refreshToken).toBeUndefined();
    const setCookie = s.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/orvyn_rt=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/auth/);
    const cookie = setCookie.split(';')[0]!;
    const r = await call<SessionResponse>(h, 'POST', '/auth/refresh', { body: {}, cookie });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).toBeUndefined();
  });

  it('revoking a device signs it out everywhere', async () => {
    const phone = (await signIn(h, OWNER, { platform: 'android' })).body;
    const r = await call(h, 'DELETE', `/me/devices/${phone.deviceId}`, { token: owner.accessToken });
    expect(r.status).toBe(200);
    expect((await call(h, 'GET', '/me', { token: phone.accessToken })).status).toBe(401);
    expect(
      (await call(h, 'POST', '/auth/refresh', { body: { refreshToken: phone.refreshToken } })).status,
    ).toBe(401);
  });

  it('cannot revoke someone else’s device', async () => {
    const friend = (await signIn(h, 'aman@example.test')).body;
    expect(
      (await call(h, 'DELETE', `/me/devices/${owner.deviceId}`, { token: friend.accessToken })).status,
    ).toBe(404);
  });
});

describe('email codes', () => {
  it('locks a code after 5 wrong attempts', async () => {
    const email = 'lock@example.test';
    const inv = await call(h, 'POST', '/admin/invites', {
      token: owner.accessToken,
      body: { email, entitlements: [] },
    });
    const invite = inv.body.link.split('/join/')[1];
    await call(h, 'POST', '/auth/email/start', { body: { email, invite } });
    const code = /\d{6}/.exec((await call<any>(h, 'GET', `/dev/mailbox?email=${email}`)).body.subject)![0];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await call(h, 'POST', '/auth/email/verify', {
            body: { email, code: wrong, device: device(), invite },
          })
        ).status,
      ).toBe(401);
    }
    const right = await call(h, 'POST', '/auth/email/verify', {
      body: { email, code, device: device(), invite },
    });
    expect(right.status).toBe(401);
  });

  it('limits how often codes can be requested', async () => {
    const statuses = [];
    for (let i = 0; i < h.env.AUTH_CODE_LIMIT + 2; i++) {
      statuses.push(
        (await call(h, 'POST', '/auth/email/start', { body: { email: 'aman@example.test' } })).status,
      );
    }
    expect(statuses).toContain(429);
  });
});

describe('Google', () => {
  it('signs in an existing account with a verified Google identity', async () => {
    const r = await call<SessionResponse>(h, 'POST', '/auth/google', {
      body: { idToken: `${OWNER}|Shubham`, device: device('android') },
    });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(owner.user.id);
    expect(r.body.user.name).toBe('Shubham');
  });
  it('still needs an invite for new people', async () => {
    const r = await call(h, 'POST', '/auth/google', {
      body: { idToken: 'new@example.test|New', device: device() },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('invite_required');
  });
});

describe('disabling a member', () => {
  it('signs them out of every device and blocks new sign-ins', async () => {
    const priya = (
      await call<SessionResponse>(h, 'POST', '/auth/google', {
        body: { idToken: 'priya@example.test|Priya', device: device() },
      })
    ).body;
    expect((await call(h, 'GET', '/me', { token: priya.accessToken })).status).toBe(200);
    await call(h, 'PUT', `/admin/users/${priya.user.id}/disabled`, {
      token: owner.accessToken,
      body: { disabled: true },
    });
    expect((await call(h, 'GET', '/me', { token: priya.accessToken })).status).toBe(401);
    expect(
      (
        await call(h, 'POST', '/auth/google', {
          body: { idToken: 'priya@example.test|Priya', device: device() },
        })
      ).status,
    ).toBe(403);
  });

  it('the owner cannot be disabled', async () => {
    const r = await call(h, 'PUT', `/admin/users/${owner.user.id}/disabled`, {
      token: owner.accessToken,
      body: { disabled: true },
    });
    expect(r.status).toBe(400);
  });
});

describe('audit log', () => {
  it('records security events without secrets', async () => {
    const r = await call<any[]>(h, 'GET', '/admin/audit?limit=500', { token: owner.accessToken });
    const actions = new Set(r.body.map((a) => a.action));
    for (const a of [
      'auth.sign_in',
      'invite.created',
      'invite.used',
      'user.entitlements_changed',
      'device.revoked',
      'user.disabled',
    ]) {
      expect(actions).toContain(a);
    }
    expect(JSON.stringify(r.body)).not.toMatch(/\b\d{6}\b.*code|refreshToken|accessToken/);
  });
});
