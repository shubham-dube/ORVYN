import { Hlc, type SessionResponse, STARTING_SETTINGS } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../src/modules/mail/mail.service';
import { NotifyService } from '../src/modules/notify/notify.service';
import {
  PUSH_SENDER,
  type PushPayload,
  type PushTargetRef,
  type SendOutcome,
} from '../src/modules/notify/push-sender';
import { toE164 } from '../src/modules/notify/whatsapp.service';
import { RemindersService } from '../src/modules/today/reminders.service';
import { FakeWhatsApp } from './fake-whatsapp';
import { call, type Harness, OWNER, signIn, startApp, waitFor } from './harness';

class Sender {
  sent: PushPayload[] = [];
  async send(_t: PushTargetRef, p: PushPayload): Promise<SendOutcome> {
    this.sent.push(p);
    return 'sent';
  }
}
const sender = new Sender();
const wa = new FakeWhatsApp();
let h: Harness;
let me: SessionResponse;
let rem: RemindersService;
const clock = new Hlc('phone');
const NOW = Date.now();

const push = (entity: string, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: me.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const list = async () =>
  (await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body.items as any[];
/** like waitFor, for conditions that need a query */
async function until(pred: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out waiting');
}
const delayedAgain = async (id: string) =>
  ((await (h.app.get(NotifyService) as any).queue.getDelayed()) as { id: string }[]).filter((j) =>
    j.id.startsWith(`deliver-${id}-again-`),
  );

beforeAll(async () => {
  await wa.start();
  h = await startApp([], wa.env(), [{ provide: PUSH_SENDER, useValue: sender }]);
  me = (await signIn(h, OWNER, { platform: 'android' })).body;
  await call(h, 'POST', '/notifications/targets', {
    token: me.accessToken,
    body: { channel: 'fcm', token: 'fcm-token-'.padEnd(40, 'x') },
  });
  rem = h.app.get(RemindersService);
  rem.now = () => NOW;
});
afterAll(async () => {
  await h.close();
  await wa.close();
});

describe('WhatsApp numbers are confirmed before they are used (D23)', () => {
  it('normalises numbers', () => {
    expect(toE164('98765 43210')).toBe('+919876543210');
    expect(toE164('+1 (415) 555-0100')).toBe('+14155550100');
    expect(toE164('12345')).toBeNull();
  });

  it('a code goes to the number; wrong codes fail; the right one confirms; the number is only shown masked', async () => {
    expect(
      (await call<any>(h, 'GET', '/notifications/channels', { token: me.accessToken })).body.whatsapp,
    ).toEqual({ available: true, masked: null, verified: false });
    const start = await call<any>(h, 'PUT', '/notifications/whatsapp', {
      token: me.accessToken,
      body: { number: '98765 43210' },
    });
    expect(start.body).toEqual({ available: true, masked: '+91 ••••• ••210', verified: false });
    expect(wa.sent.at(-1)).toMatchObject({
      to: '919876543210',
      template: 'orvyn_reminder',
      auth: 'Bearer wa-token',
    });
    // not confirmed yet: nothing is sent to it
    const before = wa.sent.length;
    expect(await h.app.get(NotifyService)['whatsapp'].notify(me.user.id, 'hi')).toBe(false);
    expect(wa.sent.length).toBe(before);
    expect(
      (
        await call(h, 'POST', '/notifications/whatsapp/verify', {
          token: me.accessToken,
          body: { code: '000000' },
        })
      ).status,
    ).toBe(400);
    const ok = await call<any>(h, 'POST', '/notifications/whatsapp/verify', {
      token: me.accessToken,
      body: { code: wa.lastCode() },
    });
    expect(ok.body.verified).toBe(true);
    expect(ok.body.masked).toBe('+91 ••••• ••210');
  });
});

describe('every way a reminder can reach me (D22)', () => {
  const setup = async (reminders: unknown) => {
    await push('today.settings', me.user.id, {
      ...STARTING_SETTINGS,
      reminders: {
        timed: [10],
        dateOnly: { mode: 'none' },
        overdueInDigest: false,
        ...((reminders as object) ?? {}),
      },
    });
  };
  const newTask = async (title: string, reminders: unknown = null) => {
    const id = v7();
    await push('today.task', id, { title, dueAt: new Date(NOW + 3_600_000).toISOString(), reminders });
    return id;
  };
  const fire = (id: string, via?: string[]) =>
    rem.remind(me.user.id, id, NOW + 3_600_000, false, via as never);

  it('a normal notification: pushed, no repeat, no copies', async () => {
    await setup({});
    const id = await newTask('Call the bank');
    const mails = () => h.app.get(MailService)['outbox'].length;
    const m0 = mails();
    await fire(id, ['push']);
    await waitFor(() => sender.sent.some((p) => p.title === 'Call the bank'));
    const n = (await list()).find((x) => x.title === 'Call the bank');
    expect(n).toMatchObject({ priority: 'normal', alarm: false });
    expect(await delayedAgain(n.id)).toEqual([]);
    expect(mails()).toBe(m0);
  });

  it('a hard notification is urgent, ignores quiet hours, and comes back until acknowledged', async () => {
    await call(h, 'PUT', '/notifications/settings', {
      token: me.accessToken,
      body: {
        quietHours: { start: '00:00', end: '23:59', timeZone: 'UTC' },
        emailFor: [],
        mutedModules: ['today'],
      },
    });
    const id = await newTask('Pay rent now');
    await fire(id, ['urgent']);
    await waitFor(() => sender.sent.some((p) => p.title === 'Pay rent now'));
    const n = (await list()).find((x) => x.title === 'Pay rent now');
    expect(n).toMatchObject({ priority: 'urgent', alarm: false });
    await until(async () => (await delayedAgain(n.id)).length === 1);
    // a normal one is held back by quiet hours and mute
    const quiet = await newTask('A quiet one');
    await fire(quiet, ['push']);
    await new Promise((r) => setTimeout(r, 400));
    expect(sender.sent.some((p) => p.title === 'A quiet one')).toBe(false);
    // acting on it (Done) stops it everywhere: the task completes, the notification clears, nothing repeats
    await call(h, 'POST', `/notifications/${n.id}/actions/done`, { token: me.accessToken });
    expect((await list()).some((x) => x.id === n.id)).toBe(false);
    await call(h, 'PUT', '/notifications/settings', {
      token: me.accessToken,
      body: { quietHours: null, emailFor: [], mutedModules: [] },
    });
  });

  it('done on another device clears the reminder too', async () => {
    const id = await newTask('Water the plants');
    await fire(id, ['urgent']);
    await until(async () => (await list()).some((x) => x.title === 'Water the plants'));
    await push('today.task', id, { completedAt: new Date().toISOString() });
    await until(async () => !(await list()).some((x) => x.title === 'Water the plants'));
  });

  it('an alarm rings (flagged to the phone), is urgent and repeats', async () => {
    const id = await newTask('Wake up for the flight');
    await fire(id, ['alarm']);
    await waitFor(() => sender.sent.some((p) => p.title === 'Wake up for the flight' && p.alarm === true));
    expect((await list()).find((x) => x.title === 'Wake up for the flight')).toMatchObject({
      alarm: true,
      priority: 'urgent',
    });
  });

  it('email goes to my address and is not pushed; WhatsApp goes to the confirmed number', async () => {
    const id = await newTask('Send the invoice');
    const pushedBefore = sender.sent.length;
    const waBefore = wa.sent.length;
    await fire(id, ['email', 'whatsapp']);
    const mail = h.app.get(MailService);
    await waitFor(() => !!mail.latestTo(OWNER) && mail.latestTo(OWNER)!.subject === 'Send the invoice');
    await waitFor(() => wa.sent.length > waBefore);
    expect(wa.sent.at(-1)).toMatchObject({ to: '919876543210' });
    expect(wa.sent.at(-1)!.text).toContain('Send the invoice');
    expect(sender.sent.length).toBe(pushedBefore); // only the inbox
    expect((await list()).some((x) => x.title === 'Send the invoice')).toBe(true);
  });

  it('a task’s own choice beats my defaults; defaults apply otherwise (planned when scheduled)', async () => {
    await setup({ via: ['alarm'] });
    const mine = await newTask('Own ways', [
      { kind: 'before', minutes: 5, via: ['email'] },
      { kind: 'before', minutes: 5, via: ['push'] },
    ]);
    const dflt = await newTask('Default ways');
    const jobs = async (id: string) =>
      ((await (rem as any).queue.getDelayed()) as { id: string; data: { via: string[] } }[])
        .filter((j) => j.id.startsWith(`rem-${id}-`))
        .map((j) => j.data.via.join('+'))
        .sort();
    expect(await jobs(mine)).toEqual(['email', 'push']); // both, at the same minute
    expect(await jobs(dflt)).toEqual(['alarm']);
  });

  it('"try it" sends a sample through the ways picked', async () => {
    const before = sender.sent.length;
    expect(
      (await call(h, 'POST', '/notifications/try', { token: me.accessToken, body: { ways: ['urgent'] } }))
        .status,
    ).toBe(200);
    await waitFor(() => sender.sent.length > before && sender.sent.at(-1)!.title === 'Sample reminder');
    expect(
      (
        await call(h, 'POST', '/notifications/try', {
          token: me.accessToken,
          body: { ways: ['carrier-pigeon'] },
        })
      ).status,
    ).toBe(400);
  });

  it('a failed WhatsApp send is retried, never silently lost', async () => {
    wa.fail = true;
    const id = await newTask('Retry me');
    const q = (h.app.get(NotifyService) as any).queue;
    await fire(id, ['whatsapp']);
    await new Promise((r) => setTimeout(r, 500));
    expect(
      ((await q.getFailed()) as unknown[]).length + ((await q.getDelayed()) as unknown[]).length,
    ).toBeGreaterThan(0);
    wa.fail = false;
  });
});
