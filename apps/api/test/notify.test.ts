import { type SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendOutcome,
} from '../src/modules/notify/push-sender';
import { msUntilQuietEnds } from '../src/modules/notify/quiet-hours';
import { call, type Harness, openSocket, OWNER, signIn, sleep, startApp, waitFor } from './harness';

class FakeSender {
  sent: { target: PushTargetRef; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(target: PushTargetRef, payload: PushPayload): Promise<SendOutcome> {
    if (this.gone.has(target.address)) return 'gone';
    this.sent.push({ target, payload });
    return 'sent';
  }
  to(address: string) {
    return this.sent.filter((s) => s.target.address === address).map((s) => s.payload);
  }
}

let h: Harness;
const sender = new FakeSender();
let phone: SessionResponse;
let laptop: SessionResponse;
const PHONE_FCM = 'fcm-token-phone-'.padEnd(40, 'x');
const LAPTOP_PUSH = 'https://push.example.test/sub/laptop';

beforeAll(async () => {
  h = await startApp([], {}, [{ provide: PUSH_SENDER, useValue: sender }]);
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: phone.accessToken,
    body: { channel: 'fcm', token: PHONE_FCM },
  });
  laptop = (await signIn(h, OWNER, { platform: 'web' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: laptop.accessToken,
    body: {
      channel: 'webpush',
      subscription: { endpoint: LAPTOP_PUSH, keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) } },
    },
  });
});
afterAll(async () => h.close());

describe('security alerts', () => {
  it('a new sign-in is announced on the other devices, not on the new one', async () => {
    await waitFor(() => sender.to(PHONE_FCM).some((p) => p.title === 'New sign-in'));
    const alert = sender.to(PHONE_FCM).find((p) => p.title === 'New sign-in')!;
    expect(alert.body).toMatch(/web/);
    expect(sender.to(LAPTOP_PUSH).some((p) => p.title === 'New sign-in')).toBe(false);
  });
});

describe('delivery', () => {
  it('reaches every device: socket for open apps, push for the rest', async () => {
    const ws = await openSocket(h, laptop.accessToken);
    const r = await call<any>(h, 'POST', '/notifications/test', { token: phone.accessToken });
    expect(r.status).toBe(201);
    await waitFor(() => ws.messages.some((m) => m.type === 'notify.new' && m.notification.id === r.body.id));
    await waitFor(
      () =>
        sender.to(PHONE_FCM).some((p) => p.id === r.body.id) &&
        sender.to(LAPTOP_PUSH).some((p) => p.id === r.body.id),
    );
    ws.close();
  });

  it('dismissing on one device clears it on the others', async () => {
    const ws = await openSocket(h, laptop.accessToken);
    const n = (await call<any>(h, 'POST', '/notifications/test', { token: phone.accessToken })).body;
    await call(h, 'POST', `/notifications/${n.id}/dismiss`, { token: phone.accessToken });
    await waitFor(() => ws.messages.some((m) => m.type === 'notify.dismissed' && m.id === n.id));
    await waitFor(() => sender.to(PHONE_FCM).some((p) => p.type === 'dismiss' && p.id === n.id)); // Android removes its copy
    const list = await call<any>(h, 'GET', '/notifications', { token: laptop.accessToken });
    expect(list.body.items.some((i: any) => i.id === n.id)).toBe(false);
    ws.close();
  });

  it('stops pushing to targets the push service says are gone', async () => {
    sender.gone.add(LAPTOP_PUSH);
    await call(h, 'POST', '/notifications/test', { token: phone.accessToken });
    await sleep(500);
    sender.gone.delete(LAPTOP_PUSH);
    const before = sender.to(LAPTOP_PUSH).length;
    const n = (await call<any>(h, 'POST', '/notifications/test', { token: phone.accessToken })).body;
    await waitFor(() => sender.to(PHONE_FCM).some((p) => p.id === n.id));
    await sleep(200);
    expect(sender.to(LAPTOP_PUSH).length).toBe(before); // disabled until the browser re-subscribes
  });

  it('cannot read or dismiss someone else’s notifications', async () => {
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: phone.accessToken,
      body: { entitlements: [] },
    });
    const friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] }))
      .body;
    const n = (await call<any>(h, 'POST', '/notifications/test', { token: phone.accessToken })).body;
    expect(
      (await call(h, 'POST', `/notifications/${n.id}/dismiss`, { token: friend.accessToken })).status,
    ).toBe(404);
    expect(
      (await call<any>(h, 'GET', '/notifications', { token: friend.accessToken })).body.items.some(
        (i: any) => i.id === n.id,
      ),
    ).toBe(false);
  });
});

describe('quiet hours', () => {
  it('computes when quiet hours end, across midnight and time zones', () => {
    const q = { start: '22:00', end: '07:00', timeZone: 'Asia/Kolkata' };
    expect(msUntilQuietEnds(new Date('2026-11-16T18:30:00Z'), q)).toBe(7 * 3600_000); // 00:00 IST → 07:00
    expect(msUntilQuietEnds(new Date('2026-11-16T16:30:00Z'), q)).toBe(9 * 3600_000); // 22:00 IST
    expect(msUntilQuietEnds(new Date('2026-11-16T06:30:00Z'), q)).toBe(0); // 12:00 IST
    expect(msUntilQuietEnds(new Date(), null)).toBe(0);
  });

  it('holds normal notifications during quiet hours', async () => {
    const now = new Date();
    const hh = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    await call(h, 'PUT', '/notifications/settings', {
      token: phone.accessToken,
      body: {
        quietHours: {
          start: hh(new Date(now.getTime() - 3600_000)),
          end: hh(new Date(now.getTime() + 3600_000)),
          timeZone: 'UTC',
        },
        emailFor: [],
        mutedModules: [],
      },
    });
    const n = (await call<any>(h, 'POST', '/notifications/test', { token: phone.accessToken })).body;
    await sleep(800);
    expect(sender.to(PHONE_FCM).some((p) => p.id === n.id)).toBe(false);
    await call(h, 'PUT', '/notifications/settings', {
      token: phone.accessToken,
      body: { quietHours: null, emailFor: ['urgent'], mutedModules: [] },
    });
  });
});
