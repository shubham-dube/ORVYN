import type { SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import {
  LivePushSender,
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendOutcome,
} from '../src/modules/notify/push-sender';
import { testEnv } from './harness';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

class FakeSender {
  sent: PushTargetRef[] = [];
  async send(target: PushTargetRef, _p: PushPayload): Promise<SendOutcome> {
    this.sent.push(target);
    return 'sent';
  }
}

let h: Harness;
const sender = new FakeSender();
let phone: SessionResponse;

beforeAll(async () => {
  h = await startApp([], {}, [{ provide: PUSH_SENDER, useValue: sender }]);
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
});
afterAll(() => h.close());

describe('push to Firebase Installation IDs (spec 0008 A)', () => {
  it('an older phone with a token, then the same phone with an FID: one active target, sent as an FID', async () => {
    const reg = (body: unknown) =>
      call(h, 'POST', '/notifications/targets', { token: phone.accessToken, body });
    expect((await reg({ channel: 'fcm', token: 'old-token-'.padEnd(40, 'x') })).status).toBeLessThan(300);
    expect((await reg({ channel: 'fcm', fid: 'fid-cX2a9Lq0Rz' })).status).toBeLessThan(300);
    expect((await reg({ channel: 'fcm' })).status).toBe(400); // one of the two
    expect((await reg({ channel: 'fcm', fid: 'fid-cX2a9Lq0Rz', token: 'x'.repeat(40) })).status).toBe(400);

    const rows = await h.app
      .get<Db>(DB)
      .execute(
        sql`select format, address, disabled_at is null as active from push_targets order by created_at`,
      );
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    expect(list).toEqual([
      { format: 'token', address: 'old-token-'.padEnd(40, 'x'), active: false },
      { format: 'fid', address: 'fid-cX2a9Lq0Rz', active: true },
    ]);

    sender.sent = [];
    await call(h, 'POST', '/notifications/test', { token: phone.accessToken, body: {} });
    expect(sender.sent.map((t) => [t.format, t.address])).toEqual([['fid', 'fid-cX2a9Lq0Rz']]);
  });

  it('the FCM request carries message.fid for an FID and message.token for an old token', async () => {
    const live = new LivePushSender(testEnv());
    (live as unknown as { fcm: unknown }).fcm = {
      project: 'p1',
      client: { getAccessToken: async () => ({ token: 'at' }) },
    };
    const bodies: any[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      bodies.push(JSON.parse(String(init!.body)));
      return new Response('{}', { status: 200 });
    });
    const payload = { id: 'n1', title: 'Hi' } as unknown as PushPayload;
    await live.send({ channel: 'fcm', format: 'fid', address: 'fid-1', keys: null }, payload);
    await live.send({ channel: 'fcm', format: 'token', address: 'tok-1', keys: null }, payload);
    spy.mockRestore();
    expect(bodies[0].message.fid).toBe('fid-1');
    expect(bodies[0].message.token).toBeUndefined();
    expect(bodies[1].message.token).toBe('tok-1');
  });
});
