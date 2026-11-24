import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotifyService } from '../src/modules/notify/notify.service';
import {
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendOutcome,
} from '../src/modules/notify/push-sender';
import { call, type Harness, OWNER, signIn, sleep, startApp, waitFor } from './harness';
import { NOTIFY_CATALOG, NOTIFY_TYPE, type SessionResponse } from '@orvyn/contracts';

class FakeSender {
  sent: { target: PushTargetRef; payload: PushPayload }[] = [];
  async send(target: PushTargetRef, payload: PushPayload): Promise<SendOutcome> {
    this.sent.push({ target, payload });
    return 'sent';
  }
  titled(t: string) {
    return this.sent.map((s) => s.payload).filter((p) => p.type === 'notify' && p.title === t);
  }
}

let h: Harness;
let me: SessionResponse;
let notify: NotifyService;
const sender = new FakeSender();
const put = (rules: Record<string, unknown>) =>
  call<any>(h, 'PUT', '/notifications/settings', {
    token: me.accessToken,
    body: { quietHours: null, emailFor: ['urgent'], mutedModules: [], rules },
  });
const inbox = async () =>
  ((await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body.items as any[]).map(
    (n) => n.title,
  );
const mailTo = async (email: string) =>
  (await call<any>(h, 'GET', `/dev/mailbox?any=1&email=${encodeURIComponent(email)}`)).body?.subject as
    string | undefined;

beforeAll(async () => {
  h = await startApp([], {}, [{ provide: PUSH_SENDER, useValue: sender }]);
  me = (await signIn(h, OWNER, { platform: 'android' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: me.accessToken,
    body: { channel: 'fcm', token: 'fcm-token-rules-'.padEnd(40, 'x') },
  });
  notify = h.app.get(NotifyService);
});
afterAll(async () => h.close());

/** Every file under src, for the catalog check. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('notifications, set your way (spec 0019)', () => {
  it('every notification the code sends names a type from the catalog (AC1)', () => {
    const missing: string[] = [];
    for (const f of files(join(__dirname, '../src'))) {
      const src = readFileSync(f, 'utf8');
      // this.send({ is the pipeline's own (in notify.service); elsewhere it means something else (the socket)
      const own = f.endsWith('notify.service.ts');
      const starts = [...src.matchAll(own ? /this\.send\(\{/g : /notify\.send\(\{|await fire\('/g)].map(
        (m) => m.index!,
      );
      for (const at of starts) {
        const block = src.slice(at, at + 900);
        if (/kind: 'test'/.test(block)) continue; // the device test in Settings
        const t = /type: '([a-z_.]+)'/.exec(block)?.[1] ?? /type,/.exec(block)?.[0];
        if (!t) missing.push(`${f.split('src')[1]} @${at}`);
        else if (t !== 'type,' && !NOTIFY_TYPE.has(t)) missing.push(`${t} (${f.split('src')[1]})`);
      }
    }
    expect(missing).toEqual([]);
    // and the catalog itself is sound
    expect(new Set(NOTIFY_CATALOG.map((t) => t.key)).size).toBe(NOTIFY_CATALOG.length);
    for (const t of NOTIFY_CATALOG) expect(t.ways.every((w) => w !== 'alarm' || t.alarm)).toBe(true);
  });

  it('the default applies; Off sends nothing; Email adds a copy; an alarm rings and repeats (AC2)', async () => {
    const send = (title: string, type: string, own = false) =>
      notify.send({ userId: me.user.id, module: 'split', kind: 'expense', type, title, own });

    await send('Default push', 'split.expense');
    await waitFor(() => sender.titled('Default push').length === 1);

    expect((await put({ 'split.expense': { on: false, ways: [] } })).status).toBe(200);
    await send('Switched off', 'split.expense');
    // …unless the item chose its own ways
    await send('Its own ways', 'split.expense', true);
    await waitFor(() => sender.titled('Its own ways').length === 1);
    expect(sender.titled('Switched off')).toHaveLength(0);
    expect(await inbox()).not.toContain('Switched off');

    await put({ 'split.expense': { on: true, ways: ['email'] } });
    await send('Email only', 'split.expense');
    for (let i = 0; i < 100 && (await mailTo(OWNER)) !== 'Email only'; i++) await sleep(40);
    expect(await mailTo(OWNER)).toBe('Email only');
    expect(sender.titled('Email only')).toHaveLength(0); // in-app and email, not pushed
    expect(await inbox()).toContain('Email only');

    await put({ 'ipo.last_day': { on: true, ways: ['alarm'] } });
    const n = await notify.send({
      userId: me.user.id,
      module: 'ipo',
      kind: 'pool',
      type: 'ipo.last_day',
      title: 'Ring ring',
    });
    expect(n).toMatchObject({ priority: 'urgent', alarm: true });
    await waitFor(() => sender.titled('Ring ring').length === 1);
  });

  it('rules are cleaned: security stays on, alarms only where they fit, defaults drop out (AC3)', async () => {
    const r = (
      await put({
        'security.new_device': { on: false, ways: [] },
        'split.added': { on: true, ways: ['alarm', 'push'] },
        'chat.message': { on: true, ways: ['push'] },
        'nope.nothing': { on: false, ways: [] },
        'today.task_reminder': { on: false, ways: [] },
      })
    ).body;
    // security can't go off (only its ways change); split.added lost the alarm and so became the default; chat's
    // is the default; unknown and per-item types aren't kept
    expect(r.rules).toEqual({ 'security.new_device': { on: true, ways: [] } });
  });

  it('“send me a sample” goes out through the type’s ways, once a minute (AC3)', async () => {
    await put({});
    const s = await call<any>(h, 'POST', '/notifications/sample', {
      token: me.accessToken,
      body: { type: 'ipo.closed' },
    });
    expect(s.status).toBe(200);
    await waitFor(() => sender.titled('Sample · Bids closed').length === 1);
    const again = await call<any>(h, 'POST', '/notifications/sample', {
      token: me.accessToken,
      body: { type: 'ipo.closed' },
    });
    expect(again.status).toBe(400);
    expect(
      (await call(h, 'POST', '/notifications/sample', { token: me.accessToken, body: { type: 'x.y' } }))
        .status,
    ).toBe(404);
  });
});
