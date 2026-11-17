import { Hlc, type SessionResponse, STARTING_SETTINGS } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RemindersService } from '../src/modules/today/reminders.service';
import { call, type Harness, OWNER, openSocket, signIn, startApp, waitFor } from './harness';

let h: Harness;
let phone: SessionResponse;
let laptop: SessionResponse;
let rem: RemindersService;
const clock = new Hlc('phone');
const NOW = new Date('2026-11-16T09:30:00+05:30').getTime();

const push = (
  s: SessionResponse,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
  op = 'upsert',
) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: { mutations: [{ mutationId: v7(), entity, entityId: id, op, fields, hlc: clock.tick() }] },
  });
const pullTask = async (s: SessionResponse, id: string) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[])
    .filter((c) => c.entityId === id)
    .at(-1).data;
const delayed = async (taskId: string) =>
  ((await (rem as any).queue.getDelayed()) as { id: string; delay: number }[])
    .filter((j) => j.id.startsWith(`rem-${taskId}-`))
    .map((j) => Math.round(j.delay / 60_000)) // minutes from the test's "now"
    .sort((a, b) => a - b);
const notifications = async (s: SessionResponse) =>
  (await call<any>(h, 'GET', '/notifications', { token: s.accessToken })).body.items as any[];
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' }); // no worker: tests fire jobs themselves
  rem = h.app.get(RemindersService);
  rem.now = () => NOW;
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
  laptop = (await signIn(h, OWNER, { platform: 'windows' })).body;
});
afterAll(() => h.close());

describe('reminders follow the person’s own settings (D17)', () => {
  const task = v7();

  it('before settings are saved, nothing is assumed: only a task’s own reminders fire', async () => {
    await push(phone, 'today.task', task, { title: 'Call the bank', dueAt: at(120) });
    expect(await delayed(task)).toEqual([]);
    await push(phone, 'today.task', task, { reminders: [{ kind: 'before', minutes: 30 }] });
    expect(await delayed(task)).toEqual([90]);
  });

  it('after saving defaults, tasks without their own use them (past ones are skipped)', async () => {
    await push(phone, 'today.task', task, { reminders: null });
    await push(phone, 'today.settings', phone.user.id, {
      ...STARTING_SETTINGS,
      reminders: { timed: [1440, 60, 10], dateOnly: { mode: 'digest', at: '08:30' }, overdueInDigest: true },
    });
    expect(await delayed(task)).toEqual([60, 110]); // 1 day before is already past
  });

  it('moving the task moves its reminders; an empty list means none for this task', async () => {
    await push(laptop, 'today.task', task, { dueAt: at(300) });
    expect(await delayed(task)).toEqual([240, 290]);
    await push(laptop, 'today.task', task, { reminders: [] });
    expect(await delayed(task)).toEqual([]);
    await push(laptop, 'today.task', task, { reminders: null });
  });

  it('a firing reminder is one live notification with the four actions', async () => {
    await rem.process({ kind: 'remind', ownerId: phone.user.id, taskId: task, momentMs: NOW + 300 * 60_000 });
    const n = (await notifications(phone)).find((x) => x.title === 'Call the bank');
    expect(n.body).toMatch(/^In 5 h · 2:30 pm$/i);
    expect(n.actions.map((a: { id: string }) => a.id)).toEqual([
      'done',
      'snooze_10m',
      'later_today',
      'tomorrow',
    ]);
    // a stale job (the task moved since) does nothing
    await rem.process({ kind: 'remind', ownerId: phone.user.id, taskId: task, momentMs: NOW + 120 * 60_000 });
    expect((await notifications(phone)).filter((x) => x.title === 'Call the bank')).toHaveLength(1);
  });
});

describe('actions work from any device and reach every device', () => {
  it('Done on the phone completes the task everywhere and clears the notification everywhere', async () => {
    const id = v7();
    await push(phone, 'today.task', { 0: id }[0]!, { title: 'Pay rent', dueAt: at(30) });
    await rem.process({ kind: 'remind', ownerId: phone.user.id, taskId: id, momentMs: NOW + 30 * 60_000 });
    const n = (await notifications(phone)).find((x) => x.title === 'Pay rent');
    const ws = await openSocket(h, laptop.accessToken);
    const r = await call(h, 'POST', `/notifications/${n.id}/actions/done`, { token: phone.accessToken });
    expect(r.status).toBe(200);
    expect((await pullTask(laptop, id)).completedAt).toBe(new Date(NOW).toISOString());
    await waitFor(() => ws.messages.some((m) => m.type === 'sync.changed'));
    await waitFor(() => ws.messages.some((m) => m.type === 'notify.dismissed' && m.id === n.id));
    ws.close();
    expect(await delayed(id)).toEqual([]); // done: nothing left to remind
  });

  it('Tomorrow, Later today and Snooze', async () => {
    const id = v7();
    await push(phone, 'today.task', id, { title: 'Water plants', dueAt: at(20) });
    const fire = async () => {
      const t = await pullTask(phone, id);
      await rem.process({
        kind: 'remind',
        ownerId: phone.user.id,
        taskId: id,
        momentMs: new Date(t.dueAt).getTime(),
      });
      return (await notifications(phone)).find((x) => x.title === 'Water plants');
    };
    let n = await fire();
    await call(h, 'POST', `/notifications/${n.id}/actions/tomorrow`, { token: phone.accessToken });
    expect((await pullTask(laptop, id)).dueAt).toBe(at(20 + 24 * 60));

    n = await fire();
    await call(h, 'POST', `/notifications/${n.id}/actions/later_today`, { token: phone.accessToken });
    expect((await pullTask(laptop, id)).dueAt).toBe(at(180)); // 12:30, on a 5-minute mark

    n = await fire();
    const before = await pullTask(laptop, id);
    await call(h, 'POST', `/notifications/${n.id}/actions/snooze_10m`, { token: phone.accessToken });
    expect((await pullTask(laptop, id)).dueAt).toBe(before.dueAt); // the task doesn't move
    expect(await delayed(id)).toContain(10);
  });

  it('refuses unknown actions and other people’s notifications', async () => {
    const n = (await notifications(phone))[0];
    expect(
      (
        await call(h, 'POST', `/notifications/${n.id}/actions/delete_everything`, {
          token: phone.accessToken,
        })
      ).status,
    ).toBe(400);
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: phone.accessToken,
      body: { entitlements: ['today'] },
    });
    const friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] }))
      .body;
    expect(
      (await call(h, 'POST', `/notifications/${n.id}/actions/done`, { token: friend.accessToken })).status,
    ).toBe(404);
  });
});

describe('date-only tasks: a summary at the time chosen', () => {
  it('one summary of today and overdue; nothing when there is nothing', async () => {
    for (const [title, dueDate] of [
      ['Renew passport', '2026-11-16'],
      ['Buy curtains', '2026-11-16'],
      ['File GST', '2026-11-14'],
      ['Later thing', '2026-11-20'],
    ])
      await push(phone, 'today.task', v7(), { title, dueDate });
    await rem.process({ kind: 'digest', ownerId: phone.user.id });
    const d = (await notifications(phone)).find((x) => x.kind === 'digest');
    expect(d.title).toBe('Today: 3 things (1 overdue)');
    expect(d.body).toContain('Renew passport');
    expect(d.body).not.toContain('Later thing');

    const schedulers = await (rem as any).queue.getJobSchedulers();
    expect(schedulers.find((s: { key: string }) => s.key === `digest-${phone.user.id}`)).toMatchObject({
      pattern: '30 8 * * *',
      tz: 'Asia/Kolkata',
    });

    await push(phone, 'today.settings', phone.user.id, {
      reminders: { timed: [10], dateOnly: { mode: 'none' }, overdueInDigest: true },
    });
    expect(
      (await (rem as any).queue.getJobSchedulers()).some(
        (s: { key: string }) => s.key === `digest-${phone.user.id}`,
      ),
    ).toBe(false);
  });
});

describe('events remind with the person’s own lead times (D17)', () => {
  const eventJobs = async (eventId: string) =>
    ((await (rem as any).queue.getDelayed()) as { id: string; delay: number; data: any }[])
      .filter((j) => j.id.startsWith(`erem-${eventId}-`))
      .map((j) => j.id.split('-').slice(-2).join(' ')) // "<start ms> <lead min>"
      .sort();

  it('a single event gets its reminders; moving it moves them; deleting it clears them', async () => {
    await push(phone, 'today.settings', phone.user.id, {
      ...STARTING_SETTINGS,
      reminders: { timed: [60, 10], dateOnly: { mode: 'none' }, overdueInDigest: false },
    });
    const id = v7();
    await push(phone, 'today.event', id, { title: 'Dentist', start: at(120), end: at(150), location: 'MG Road' });
    const start = Date.parse(at(120));
    expect(await eventJobs(id)).toEqual([`${start} 10`, `${start} 60`]);
    await push(phone, 'today.event', id, { start: at(30), end: at(60) });
    expect(await eventJobs(id)).toEqual([`${Date.parse(at(30))} 10`]); // an hour before is already past
    await push(phone, 'today.event', id, {}, 'delete');
    expect(await eventJobs(id)).toEqual([]);
  });

  it('a repeating event reminds about its next occurrence, skips a cancelled one, and lines up the next', async () => {
    const id = v7();
    const first = Date.parse(at(30)) - 86_400_000; // started yesterday, 30 min from now each day
    await push(phone, 'today.event', id, {
      title: 'Standup',
      start: new Date(first).toISOString(),
      end: new Date(first + 15 * 60_000).toISOString(),
      rrule: 'FREQ=DAILY',
    });
    const today = first + 86_400_000;
    expect(await eventJobs(id)).toEqual([`${today} 10`]);

    // cancel today's: tomorrow's comes up
    await push(phone, 'today.event', id, { exdates: [new Date(today).toISOString()] });
    expect(await eventJobs(id)).toEqual([`${today + 86_400_000} 10`, `${today + 86_400_000} 60`]);

    // it fires, as a notification with the time, and the one after is lined up
    await push(phone, 'today.event', id, { exdates: [] });
    rem.now = () => today - 10 * 60_000;
    await rem.remindEvent(phone.user.id, id, today);
    rem.now = () => NOW;
    const n = (await notifications(phone)).find((x) => x.title === 'Standup');
    expect(n.body).toMatch(/^In 10 min · /);
    expect(n.actions).toEqual([]);
    expect(await eventJobs(id)).toContain(`${today + 86_400_000} 60`);
  });

  it('a stale reminder for a moved event says nothing', async () => {
    const id = v7();
    await push(phone, 'today.event', id, { title: 'Moved meeting', start: at(200), end: at(230) });
    await rem.remindEvent(phone.user.id, id, Date.parse(at(100)));
    expect((await notifications(phone)).some((x) => x.title === 'Moved meeting')).toBe(false);
  });
});
