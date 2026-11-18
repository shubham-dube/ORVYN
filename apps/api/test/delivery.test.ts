import { type SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendResult,
} from '../src/modules/notify/push-sender';
import { call, type Harness, openSocket, OWNER, signIn, startApp } from './harness';

/** FCM is set up; the browser's subscription has expired; another browser's push service refuses. */
class Sender {
  sent: string[] = [];
  capabilities() {
    return { webpush: true, fcm: true };
  }
  async send(t: PushTargetRef, _p: PushPayload): Promise<SendResult> {
    if (t.address.includes('expired'))
      return { outcome: 'gone', detail: 'this browser’s subscription expired' };
    if (t.address.includes('broken'))
      return { outcome: 'failed', detail: '403 the VAPID key does not match' };
    this.sent.push(t.address);
    return 'sent';
  }
}

let h: Harness;
const sender = new Sender();
let phone: SessionResponse;
let laptop: SessionResponse;
let windows: SessionResponse;

beforeAll(async () => {
  h = await startApp([], {}, [{ provide: PUSH_SENDER, useValue: sender }]);
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: phone.accessToken,
    body: { channel: 'fcm', token: 'fcm-phone-'.padEnd(40, 'x') },
  });
  laptop = (await signIn(h, OWNER, { platform: 'web' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: laptop.accessToken,
    body: {
      channel: 'webpush',
      subscription: {
        endpoint: 'https://push.example.test/broken',
        keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) },
      },
    },
  });
  windows = (await signIn(h, OWNER, { platform: 'windows' })).body;
});
afterAll(async () => h.close());

describe('delivery checks (spec 0007 A3)', () => {
  it('a test reports, per device, what each push service answered — and open apps get it live', async () => {
    const tray = await openSocket(h, windows.accessToken);
    const r = await call<any>(h, 'POST', '/notifications/test', { token: laptop.accessToken, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.live).toContain(windows.deviceId);
    const byDevice = Object.fromEntries(r.body.push.map((p: any) => [p.deviceId, p]));
    expect(byDevice[phone.deviceId]).toMatchObject({ channel: 'fcm', outcome: 'sent' });
    expect(byDevice[laptop.deviceId]).toMatchObject({
      channel: 'webpush',
      outcome: 'failed',
      detail: /VAPID/,
    });
    tray.close();
  });

  it('the delivery view shows each device: open now, push targets, the last result and its reason', async () => {
    const d = (await call<any>(h, 'GET', '/notifications/delivery', { token: phone.accessToken })).body;
    expect(d.server).toEqual({ webpush: true, fcm: true });
    const dev = (id: string) => d.devices.find((x: any) => x.id === id);
    expect(dev(phone.deviceId).push[0]).toMatchObject({ channel: 'fcm', active: true, lastResult: 'sent' });
    expect(dev(laptop.deviceId).push[0]).toMatchObject({ lastResult: 'failed', lastError: /VAPID/ });
    expect(dev(windows.deviceId).push).toEqual([]);
  });

  it('a test can target one device only', async () => {
    sender.sent = [];
    const r = await call<any>(h, 'POST', '/notifications/test', {
      token: phone.accessToken,
      body: { deviceId: phone.deviceId },
    });
    expect(r.body.push.map((p: any) => p.deviceId)).toEqual([phone.deviceId]);
    expect(sender.sent).toHaveLength(1);
  });

  it('an expired browser subscription is switched off and says why', async () => {
    await call(h, 'POST', '/notifications/targets', {
      token: laptop.accessToken,
      body: {
        channel: 'webpush',
        subscription: {
          endpoint: 'https://push.example.test/expired',
          keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) },
        },
      },
    });
    await call(h, 'POST', '/notifications/test', {
      token: laptop.accessToken,
      body: { deviceId: laptop.deviceId },
    });
    const d = (await call<any>(h, 'GET', '/notifications/delivery', { token: laptop.accessToken })).body;
    const t = d.devices
      .find((x: any) => x.id === laptop.deviceId)
      .push.find((p: any) => p.lastResult === 'gone');
    expect(t).toMatchObject({ active: false, lastError: /expired/ });
  });
});
