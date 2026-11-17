import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecurrenceService } from '../src/modules/today/recurrence.service';
import { RemindersService } from '../src/modules/today/reminders.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let phone: SessionResponse;
const clock = new Hlc('phone');
const NOW = new Date('2026-11-16T09:30:00+05:30').getTime(); // Monday

const push = (id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: phone.accessToken,
    body: {
      mutations: [
        { mutationId: v7(), entity: 'today.task', entityId: id, op: 'upsert', fields, hlc: clock.tick() },
      ],
    },
  });
const task = async (id: string) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: phone.accessToken })).body.changes as any[])
    .filter((c) => c.entityId === id)
    .at(-1).data;

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  h.app.get(RecurrenceService).now = () => NOW;
  h.app.get(RemindersService).now = () => NOW;
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
});
afterAll(() => h.close());

describe('repeating tasks roll forward when done (AC4)', () => {
  it('a daily date-only task moves to tomorrow and remembers when it was done', async () => {
    const id = v7();
    await push(id, {
      title: 'Water the plants',
      dueDate: '2026-11-16',
      rrule: 'FREQ=DAILY',
      timeZone: 'Asia/Kolkata',
    });
    await push(id, { completedAt: new Date(NOW).toISOString() });
    const t = await task(id);
    expect(t).toMatchObject({
      dueDate: '2026-11-17',
      completedAt: null,
      lastDoneAt: new Date(NOW).toISOString(),
    });
  });

  it('a weekly timed task keeps its wall time, and a scheduled block moves with it; the checklist resets', async () => {
    const id = v7();
    await push(id, {
      title: 'Gym',
      dueAt: '2026-11-16T07:00:00+05:30',
      scheduledStart: '2026-11-16T06:30:00+05:30',
      durationMin: 60,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
      checklist: [{ id: 'a', text: 'shoes', done: true }],
    });
    await push(id, { completedAt: new Date(NOW).toISOString() });
    const t = await task(id);
    expect(new Date(t.dueAt).toISOString()).toBe(new Date('2026-11-19T07:00:00+05:30').toISOString());
    expect(new Date(t.scheduledStart).toISOString()).toBe(
      new Date('2026-11-19T06:30:00+05:30').toISOString(),
    );
    expect(t.checklist[0].done).toBe(false);
    expect(t.completedAt).toBeNull();
  });

  it('a habit missed for days skips to the next one still ahead, not the ones already gone', async () => {
    const id = v7();
    await push(id, { title: 'Journal', dueDate: '2026-11-10', rrule: 'FREQ=DAILY' });
    await push(id, { completedAt: new Date(NOW).toISOString() });
    expect((await task(id)).dueDate).toBe('2026-11-16'); // today still counts
  });

  it('when the repeat has ended it stays done; non-repeating tasks are untouched', async () => {
    const ended = v7();
    await push(ended, { title: 'Course', dueDate: '2026-11-16', rrule: 'FREQ=DAILY;COUNT=1' });
    await push(ended, { completedAt: new Date(NOW).toISOString() });
    expect((await task(ended)).completedAt).not.toBeNull();
    const plain = v7();
    await push(plain, { title: 'Once', dueDate: '2026-11-16' });
    await push(plain, { completedAt: new Date(NOW).toISOString() });
    expect(await task(plain)).toMatchObject({ completedAt: new Date(NOW).toISOString(), lastDoneAt: null });
  });

  it('“Done” from a reminder rolls it forward too', async () => {
    const id = v7();
    await push(id, { title: 'Pay rent', dueDate: '2026-11-16', rrule: 'FREQ=MONTHLY;BYMONTHDAY=16' });
    await h.app.get(RecurrenceService).roll(phone.user.id, id); // nothing to do: not done yet
    expect((await task(id)).dueDate).toBe('2026-11-16');
    await push(id, { completedAt: new Date(NOW).toISOString() });
    expect((await task(id)).dueDate).toBe('2026-12-16');
  });
});
