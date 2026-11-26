import { NOTIFY_CATALOG, type SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendResult,
  fit,
} from '../src/modules/notify/push-sender';
import { NotifyService } from '../src/modules/notify/notify.service';
import { msUntilQuietEnds } from '../src/modules/notify/quiet-hours';
import { call, type Harness, openSocket, OWNER, signIn, sleep, startApp, waitFor } from './harness';

class FakeSender {
  sent: { target: PushTargetRef; payload: PushPayload }[] = [];
  gone = new Set<string>();
  down = false;
  async send(target: PushTargetRef, payload: PushPayload): Promise<SendResult> {
    if (this.gone.has(target.address)) return 'gone';
    if (this.down) return { outcome: 'failed', detail: '503', again: true };
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
    // (the test button pushes at once on purpose; an ordinary notification waits for quiet hours to end)
    const n = await h.app
      .get(NotifyService)
      .send({ userId: phone.user.id, module: 'core', kind: 'test', title: 'Quiet please' });
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

  it('a device that was away gets each missed one once, and nothing meant for the inbox only (spec 0021 #5)', async () => {
    const n = h.app.get(NotifyService);
    const missed = async (who: SessionResponse, since?: string) =>
      (
        await call<any>(
          h,
          'GET',
          `/notifications/missed${since ? `?since=${encodeURIComponent(since)}` : ''}`,
          {
            token: who.accessToken,
          },
        )
      ).body;
    const first = await missed(laptop);
    expect(first.items).toEqual([]); // a new device doesn't replay the past
    const say = (over: object) =>
      n.send({ userId: phone.user.id, module: 'core', kind: 'note', title: 'x', ...over });
    const chat = { title: 'Chat', dedupeKey: 'missed:chat' };
    await say(chat);
    await say({ title: 'Own', sourceDeviceId: laptop.deviceId });
    expect((await say({ title: 'Inbox only', via: { push: false } })).silent).toBe(true);
    const mine = (m: any) =>
      m.items.map((i: any) => i.title).filter((t: string) => ['Chat', 'Own', 'Inbox only'].includes(t));
    const a = await missed(laptop, first.until);
    expect(mine(a)).toEqual(['Chat']);
    const before = a.items.find((i: any) => i.title === 'Chat');
    expect(mine(await missed(laptop, new Date(Date.now() + 3_600_000).toISOString()))).toEqual([]);
    await say(chat); // the same conversation speaks again
    const again = (await missed(laptop, a.until)).items.find((i: any) => i.title === 'Chat');
    expect(again.id).toBe(before.id);
    expect(again.updatedAt).not.toBe(before.updatedAt); // how the device knows it is new
    await call(h, 'POST', `/notifications/${before.id}/read`, { token: phone.accessToken });
    const after = await missed(laptop, first.until);
    expect(mine(after)).toEqual([]);
    expect(after.cleared).toContain(before.id); // its toast on a PC that slept goes too
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

describe('nothing is lost on the way (spec 0023)', () => {
  const queue = () => (h.app.get(NotifyService) as any).queue;
  const run = (data: any) => (h.app.get(NotifyService) as any).process(data);
  const say = (over: object) =>
    h.app
      .get(NotifyService)
      .send({ userId: phone.user.id, module: 'core', kind: 'note', title: 'x', ...over } as any);

  it('a push service that is down is tried again where it failed, and the phone stays registered', async () => {
    sender.down = true;
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push((await say({ title: `Down ${i}` })).id);
    await waitFor(() => true);
    await sleep(700);
    sender.down = false;
    const jobs = (await queue().getDelayed()).filter((j: any) => j.data.kind === 'push');
    expect(new Set(jobs.map((j: any) => j.data.id))).toEqual(new Set(ids));
    await run(jobs[0].data);
    expect(sender.to(PHONE_FCM).filter((p) => p.id === jobs[0].data.id)).toHaveLength(1);
    const d = (await call<any>(h, 'GET', '/notifications/delivery', { token: phone.accessToken })).body;
    expect(d.devices.find((x: any) => x.id === phone.deviceId).push[0].active).toBe(true);
  });

  it('an urgent one comes back on every device, also the second time under the same key; acting ends it', async () => {
    const ws = await openSocket(h, laptop.accessToken);
    const key = { title: 'Ring', dedupeKey: 'ring', priority: 'urgent', repeat: { everyMin: 5, times: 2 } };
    const again = async (id: string) =>
      (await queue().getDelayed()).filter((j: any) => j.data.id === id && j.data.again).at(-1)?.data;
    const heard = (id: string) =>
      ws.messages.filter((m) => m.type === 'notify.new' && m.notification.id === id).length;
    const n = await say(key);
    await sleep(400);
    const first = await again(n.id);
    await run(first);
    await waitFor(() => heard(n.id) === 2); // the PC and Chrome hear it again, as a new moment
    const times = ws.messages.filter((m) => m.notification?.id === n.id).map((m) => m.notification.updatedAt);
    expect(new Set(times).size).toBe(2);
    await say(key); // it is due again, under the same key
    await sleep(400);
    const before = sender.to(PHONE_FCM).filter((p) => p.id === n.id).length;
    await run(first); // left over from the first time
    expect(sender.to(PHONE_FCM).filter((p) => p.id === n.id).length).toBe(before);
    const jobs = (await queue().getDelayed()).filter((j: any) => j.data.id === n.id && j.data.again);
    expect(jobs.length).toBeGreaterThan(1); // the second time has repeats of its own
    await call(h, 'POST', `/notifications/${n.id}/dismiss`, { token: phone.accessToken });
    await run(jobs.at(-1).data);
    expect(sender.to(PHONE_FCM).filter((p) => p.id === n.id && p.type === 'notify').length).toBe(before);
    ws.close();
  });

  it('held by quiet hours: shown live when they end', async () => {
    const ws = await openSocket(h, laptop.accessToken);
    const n = await say({ title: 'Held' });
    await sleep(200);
    const at = new Date(n.updatedAt!).getTime();
    await run({ kind: 'deliver', id: n.id, at, held: true });
    await waitFor(() => ws.messages.filter((m) => m.notification?.id === n.id).length === 2);
    ws.close();
  });

  it('a long Hindi text still fits a push', () => {
    const p = fit({
      type: 'notify',
      id: 'x',
      title: 'शीर्षक '.repeat(25),
      body: 'यह एक लंबा संदेश है। '.repeat(50),
      actions: [{ id: 'done', label: 'Done' }],
    });
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(3400);
    expect(p.body!.length).toBeGreaterThan(50);
    expect(p.actions).toHaveLength(1);
    expect(fit({ type: 'notify', id: 'x', body: 'short' }).body).toBe('short');
  });

  it('every type in the catalog reaches the phone the way it says', async () => {
    for (const t of NOTIFY_CATALOG) {
      const r = await call<any>(h, 'POST', '/notifications/sample', {
        token: laptop.accessToken,
        body: { type: t.key },
      });
      expect([t.key, r.status]).toEqual([t.key, 200]);
      const pushed = () => sender.to(PHONE_FCM).some((p) => p.title === `Sample · ${t.label}`);
      if (t.ways.includes('push') || t.managedIn) await waitFor(pushed);
      else {
        await sleep(150);
        expect([t.key, pushed()]).toEqual([t.key, false]);
      }
    }
  }, 60_000);
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
    const n = await h.app
      .get(NotifyService)
      .send({ userId: phone.user.id, module: 'core', kind: 'test', title: 'Shh' });
    await sleep(800);
    expect(sender.to(PHONE_FCM).some((p) => p.id === n.id)).toBe(false);
    await call(h, 'PUT', '/notifications/settings', {
      token: phone.accessToken,
      body: { quietHours: null, emailFor: ['urgent'], mutedModules: [] },
    });
  });
});
