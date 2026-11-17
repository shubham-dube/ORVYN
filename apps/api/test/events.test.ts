import { Hlc, type SessionResponse, STARTING_SETTINGS } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from '../src/modules/sync/sync.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
const clock = new Hlc('dev');

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
const rejected = async (p: ReturnType<typeof push>) =>
  (await p).body.rejected[0]?.reason as string | undefined;
const latest = async (s: SessionResponse, id: string) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[])
    .filter((c) => c.entityId === id)
    .at(-1)?.data;

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['today'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(() => h.close());

describe('events and calendars sync like everything else', () => {
  const cal = v7();

  it('events need a sensible time shape', async () => {
    expect(await rejected(push(me, 'today.event', v7(), { title: 'x' }))).toBe(
      'an event needs a start and end time',
    );
    expect(
      await rejected(
        push(me, 'today.event', v7(), {
          title: 'x',
          start: '2026-11-16T10:00:00Z',
          end: '2026-11-16T09:00:00Z',
        }),
      ),
    ).toBe('an event must end after it starts');
    expect(
      await rejected(
        push(me, 'today.event', v7(), {
          title: 'x',
          allDay: true,
          startDate: '2026-11-16',
          endDate: '2026-11-16',
        }),
      ),
    ).toBe('an all-day event must end after it starts');
  });

  it('a later edit of only the end is checked against the stored start', async () => {
    const id = v7();
    await push(me, 'today.event', id, {
      title: 'Dentist',
      start: '2026-11-16T10:00:00Z',
      end: '2026-11-16T11:00:00Z',
    });
    expect(await rejected(push(me, 'today.event', id, { end: '2026-11-16T09:00:00Z' }))).toBe(
      'an event must end after it starts',
    );
    expect(await rejected(push(me, 'today.event', id, { end: '2026-11-16T12:00:00Z' }))).toBeUndefined();
    expect(new Date((await latest(me, id)).end).toISOString()).toBe('2026-11-16T12:00:00.000Z');
  });

  it('calendars and series must be your own', async () => {
    await push(me, 'today.calendar', cal, { name: 'Personal', primary: true });
    expect(
      await rejected(
        push(friend, 'today.event', v7(), {
          title: 'x',
          start: '2026-11-16T10:00:00Z',
          end: '2026-11-16T11:00:00Z',
          calendarId: cal,
        }),
      ),
    ).toBe('unknown calendar');
    expect(
      await rejected(
        push(friend, 'today.event', v7(), {
          title: 'x',
          start: '2026-11-16T10:00:00Z',
          end: '2026-11-16T11:00:00Z',
          recurringEventId: v7(),
        }),
      ),
    ).toBe('unknown series');
    expect(await latest(friend, cal)).toBeUndefined();
  });

  it('a device cannot fabricate a Google calendar, only switch one on/off or recolour it', async () => {
    expect(await rejected(push(me, 'today.calendar', v7(), { name: 'Work', provider: 'google' }))).toBe(
      'connected calendars are managed by their account',
    );
    const g = v7();
    const sync = h.app.get(SyncService);
    const p = {
      userId: me.user.id,
      deviceId: '00000000-0000-0000-0000-000000000000',
      role: 'owner',
      entitlements: new Set(['today']),
    } as any;
    await sync.pushAsServer(p, [
      {
        entity: 'today.calendar',
        entityId: g,
        op: 'upsert',
        fields: { name: 'Work', provider: 'google', writable: false },
      },
    ]);
    expect(
      await rejected(push(me, 'today.calendar', g, { visible: false, colour: 'amber' })),
    ).toBeUndefined();
    expect(await rejected(push(me, 'today.calendar', g, { name: 'Renamed' }))).toBe(
      'connected calendars are managed by their account',
    );
    expect(
      await rejected(
        push(me, 'today.event', v7(), {
          title: 'x',
          start: '2026-11-16T10:00:00Z',
          end: '2026-11-16T11:00:00Z',
          calendarId: g,
        }),
      ),
    ).toBe('that calendar is read-only');
  });

  it('a changed occurrence points at its series', async () => {
    const series = v7();
    await push(me, 'today.event', series, {
      title: 'Standup',
      start: '2026-11-16T04:30:00Z',
      end: '2026-11-16T04:45:00Z',
      rrule: 'FREQ=DAILY',
      calendarId: cal,
    });
    await push(me, 'today.event', series, { exdates: ['2026-11-17T04:30:00.000Z'] });
    const moved = v7();
    expect(
      await rejected(
        push(me, 'today.event', moved, {
          title: 'Standup',
          start: '2026-11-18T05:30:00Z',
          end: '2026-11-18T05:45:00Z',
          recurringEventId: series,
          originalStart: '2026-11-18T04:30:00.000Z',
        }),
      ),
    ).toBeUndefined();
    expect((await latest(me, series)).exdates).toEqual(['2026-11-17T04:30:00.000Z']);
  });
});

describe('plan my day (POST /today/plan)', () => {
  const day = '2030-01-07'; // a Monday, safely in the future

  it('without working hours, it says so instead of assuming (D16)', async () => {
    const r = await call<any>(h, 'POST', '/today/plan', { token: friend.accessToken, body: { date: day } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('no_working_hours');
  });

  it('plans around events (repeats included), with reasons, and changes nothing', async () => {
    await push(me, 'today.settings', me.user.id, { ...STARTING_SETTINGS, timeZone: 'Asia/Kolkata' });
    const t1 = v7();
    const t2 = v7();
    await push(me, 'today.task', t1, { title: 'Write report', dueDate: day, durationMin: 90, priority: 3 });
    await push(me, 'today.task', t2, { title: 'Call mum', dueDate: day });
    await push(me, 'today.event', v7(), {
      title: 'Deep work',
      start: '2030-01-07T10:00:00+05:30',
      end: '2030-01-07T12:00:00+05:30',
    });
    const r = await call<any>(h, 'POST', '/today/plan', { token: me.accessToken, body: { date: day } });
    expect(r.status).toBe(200);
    const times = r.body.placed.map((p: any) => [
      p.title,
      new Date(p.start).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
      }),
    ]);
    // the daily standup series (from 2026) also sits on this Monday at 10:00–10:15, inside Deep work
    expect(times).toEqual([
      ['Write report', '12:15'],
      ['Call mum', '14:00'],
    ]);
    expect(r.body.placed[0].reason).toMatch(/due today · high priority · 90 min/);
    expect((await latest(me, t1)).scheduledStart).toBeNull();
  });

  it('only for people with Today', async () => {
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: me.accessToken,
      body: { email: 'guest@example.test', entitlements: ['chat'] },
    });
    const guest = (await signIn(h, 'guest@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
    expect(
      (await call(h, 'POST', '/today/plan', { token: guest.accessToken, body: { date: day } })).status,
    ).toBe(403);
  });
});
