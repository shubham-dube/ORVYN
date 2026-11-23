import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import { CalendarService } from '../src/modules/calendar/calendar.service';
import { FakeGoogleCalendar } from './fake-google-calendar';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

const g = new FakeGoogleCalendar();
let h: Harness;
let me: SessionResponse;
let cal: CalendarService;
const clock = new Hlc('phone');

const push = (id: string, fields: Record<string, unknown>, op = 'upsert') =>
  call<any>(h, 'POST', '/sync/push', {
    token: me.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity: 'today.event', entityId: id, op, fields, hlc: clock.tick() }],
    },
  });
const pushCal = (id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: me.accessToken,
    body: {
      mutations: [
        { mutationId: v7(), entity: 'today.calendar', entityId: id, op: 'upsert', fields, hlc: clock.tick() },
      ],
    },
  });
/** What a device would hold after a full pull: entity/id → latest data (deleted ones gone). */
async function mirror() {
  const rows = new Map<string, any>();
  let cursor = '0';
  for (;;) {
    const r = (await call<any>(h, 'GET', `/sync/pull?cursor=${cursor}`, { token: me.accessToken })).body;
    for (const c of r.changes) {
      if (c.op === 'delete') rows.delete(`${c.entity}/${c.entityId}`);
      else rows.set(`${c.entity}/${c.entityId}`, { id: c.entityId, ...c.data });
    }
    cursor = r.cursor;
    if (!r.hasMore) break;
  }
  const of = (e: string) => [...rows.entries()].filter(([k]) => k.startsWith(`${e}/`)).map(([, v]) => v);
  return { calendars: of('today.calendar'), events: of('today.event') };
}
async function connect(email: string) {
  const r = await call<any>(h, 'POST', '/calendar/google/start', { token: me.accessToken });
  expect(r.status).toBe(200);
  const auth = new URL(r.body.url);
  expect(auth.searchParams.get('access_type')).toBe('offline');
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(auth.searchParams.get('scope')).toContain('calendar.events');
  const back = await fetch(
    `${h.url}/calendar/google/callback?code=code-${email}&state=${auth.searchParams.get('state')}`,
    { redirect: 'manual' },
  );
  expect(back.status).toBe(302);
  await cal.drain();
  return back.headers.get('location');
}

beforeAll(async () => {
  await g.start();
  g.addAccount('asha@gmail.test', [
    { id: 'asha@gmail.test', summary: 'Asha', primary: true, accessRole: 'owner' },
    { id: 'holidays', summary: 'Holidays in India', selected: false, accessRole: 'reader' },
  ]);
  g.addAccount('asha@work.test', [
    { id: 'asha@work.test', summary: 'Work', primary: true, accessRole: 'owner' },
    // Google's public holidays, switched on in Google (spec 0014: they arrive hidden in ORVYN)
    {
      id: 'en.indian#holiday@group.v.calendar.google.com',
      summary: 'Holidays in India',
      selected: true,
      accessRole: 'reader',
    },
  ]);
  const tz = { timeZone: 'Asia/Kolkata' };
  g.put('asha@gmail.test', 'asha@gmail.test', {
    id: 'dentist',
    summary: 'Dentist',
    location: 'MG Road',
    start: { dateTime: '2030-01-07T10:00:00+05:30', ...tz },
    end: { dateTime: '2030-01-07T11:00:00+05:30', ...tz },
  });
  g.put('asha@gmail.test', 'asha@gmail.test', {
    id: 'yoga',
    summary: 'Yoga',
    start: { dateTime: '2030-01-06T07:00:00+05:30', ...tz },
    end: { dateTime: '2030-01-06T08:00:00+05:30', ...tz },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU', 'EXDATE;TZID=Asia/Kolkata:20300113T070000'],
  });
  g.put('asha@gmail.test', 'asha@gmail.test', {
    id: 'yoga_20300120T013000Z',
    recurringEventId: 'yoga',
    originalStartTime: { dateTime: '2030-01-20T07:00:00+05:30' },
    summary: 'Yoga (late)',
    start: { dateTime: '2030-01-20T09:00:00+05:30', ...tz },
    end: { dateTime: '2030-01-20T10:00:00+05:30', ...tz },
  });
  g.put('asha@gmail.test', 'asha@gmail.test', {
    id: 'yoga_20300127T013000Z',
    recurringEventId: 'yoga',
    originalStartTime: { dateTime: '2030-01-27T07:00:00+05:30' },
    status: 'cancelled',
  });
  g.put('asha@gmail.test', 'holidays', {
    id: 'diwali',
    summary: 'Holiday',
    start: { date: '2030-10-26' },
    end: { date: '2030-10-27' },
  });
  g.put('asha@work.test', 'asha@work.test', {
    id: 'standup',
    summary: 'Standup',
    start: { dateTime: '2030-01-07T09:30:00+05:30', ...tz },
    end: { dateTime: '2030-01-07T09:45:00+05:30', ...tz },
  });
  h = await startApp([], { PROCESS_ROLE: 'api', ...g.env() });
  cal = h.app.get(CalendarService);
  me = (await signIn(h, OWNER)).body;
});
afterAll(async () => {
  await h.close();
  await g.close();
});

describe('connecting Google accounts (D15: several per person)', () => {
  it('connects, lists calendars (shown as Google shows them), and syncs events with repeats and exceptions', async () => {
    expect(await connect('asha@gmail.test')).toMatch(/\/settings\?calendar=connected$/);
    const m = await mirror();
    expect(m.calendars.map((c) => [c.name, c.provider, c.visible, c.writable]).sort()).toEqual([
      ['Asha', 'google', true, true],
      ['Holidays in India', 'google', false, false],
    ]);
    const byTitle = (t: string) => m.events.filter((e) => e.title === t);
    expect(byTitle('Dentist')[0]).toMatchObject({
      location: 'MG Road',
      start: '2030-01-07T04:30:00.000Z',
      externalId: 'dentist',
    });
    const yoga = byTitle('Yoga')[0];
    expect(yoga).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=SU', exdates: ['2030-01-13T01:30:00.000Z'] });
    expect(byTitle('Yoga (late)')[0]).toMatchObject({
      recurringEventId: yoga.id,
      originalStart: '2030-01-20T01:30:00.000Z',
    });
    expect(m.events.find((e) => e.cancelled)).toMatchObject({
      recurringEventId: yoga.id,
      originalStart: '2030-01-27T01:30:00.000Z',
    });
    expect(byTitle('Holiday')).toEqual([]); // hidden calendars are not synced
  });

  it('a second account adds its own calendars; reconnecting never duplicates (AC3)', async () => {
    await connect('asha@work.test');
    await connect('asha@gmail.test'); // again
    const accounts = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body;
    expect(accounts.map((a: any) => [a.email, a.status]).sort()).toEqual([
      ['asha@gmail.test', 'active'],
      ['asha@work.test', 'active'],
    ]);
    const m = await mirror();
    expect(m.calendars).toHaveLength(4);
    // a public-holiday calendar comes hidden even when Google shows it: one per account would repeat every holiday
    expect(
      m.calendars.find((c) => c.externalId === 'en.indian#holiday@group.v.calendar.google.com'),
    ).toMatchObject({ visible: false });
    expect(m.events.filter((e) => e.title === 'Dentist')).toHaveLength(1);
    expect(m.events.filter((e) => e.title === 'Standup')).toHaveLength(1);
  });

  it('tokens are stored only encrypted', async () => {
    const db = h.app.get<Db>(DB);
    const rows = (await db.execute(
      sql`select refresh_token_enc, access_token_enc from calendar_accounts`,
    )) as unknown as {
      rows?: any[];
    } & any[];
    const text = JSON.stringify(rows);
    expect(text).not.toContain('rt-asha');
    expect(text).not.toContain('at-asha');
    expect(text).toContain('v1.');
  });

  it('switching a calendar on syncs it', async () => {
    const holidays = (await mirror()).calendars.find((c) => c.name === 'Holidays in India');
    await pushCal(holidays.id, { visible: true, colour: 'amber' });
    await cal.drain();
    expect((await mirror()).events.some((e) => e.title === 'Holiday' && e.allDay)).toBe(true);
  });
});

describe('Google → ORVYN', () => {
  it('changes and deletions made on Google arrive on the next poll, incrementally', async () => {
    g.put('asha@gmail.test', 'asha@gmail.test', {
      id: 'dentist',
      summary: 'Dentist (moved)',
      start: { dateTime: '2030-01-08T10:00:00+05:30' },
      end: { dateTime: '2030-01-08T11:00:00+05:30' },
    });
    g.put('asha@gmail.test', 'asha@gmail.test', {
      id: 'lunch',
      summary: 'Lunch',
      start: { dateTime: '2030-01-09T13:00:00+05:30' },
      end: { dateTime: '2030-01-09T14:00:00+05:30' },
    });
    const before = g.requests.length;
    const account = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@gmail.test',
    );
    await call(h, 'POST', `/calendar/accounts/${account.id}/sync`, { token: me.accessToken });
    const lists = g.requests.slice(before).filter((r) => r.method === 'GET' && r.path.endsWith('/events'));
    expect(lists.length).toBeGreaterThan(0);
    let m = await mirror();
    expect(m.events.find((e) => e.externalId === 'dentist')).toMatchObject({
      title: 'Dentist (moved)',
      start: '2030-01-08T04:30:00.000Z',
    });
    expect(m.events.some((e) => e.title === 'Lunch')).toBe(true);

    g.put('asha@gmail.test', 'asha@gmail.test', { id: 'lunch', status: 'cancelled' });
    await cal.poll(me.user.id, account.id);
    m = await mirror();
    expect(m.events.some((e) => e.title === 'Lunch')).toBe(false);
  });

  it('a stale sync token falls back to a full sync without duplicating', async () => {
    const db = h.app.get<Db>(DB);
    await db.execute(sql`update calendar_sync_state set sync_token = 'st-expired'`);
    const account = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@gmail.test',
    );
    await cal.poll(me.user.id, account.id);
    const m = await mirror();
    expect(m.events.filter((e) => e.externalId === 'dentist')).toHaveLength(1);
  });

  it('the webhook only accepts Google’s channel token', async () => {
    expect(await cal.webhook('nope', 'forged')).toBe(false);
    const r = await fetch(`${h.url}/calendar/google/webhook`, {
      method: 'POST',
      headers: { 'x-goog-channel-id': 'nope', 'x-goog-channel-token': 'forged' },
    });
    expect(r.status).toBe(200); // Google is always answered; nothing happens
  });
});

describe('ORVYN → Google', () => {
  const primary = async () => (await mirror()).calendars.find((c) => c.name === 'Asha');

  it('an event made on a phone goes to Google once, and comes back as the same event', async () => {
    const c = await primary();
    const id = v7();
    await push(id, {
      title: 'Call with CA',
      start: '2030-01-10T06:30:00.000Z',
      end: '2030-01-10T07:00:00.000Z',
      calendarId: c.id,
      timeZone: 'Asia/Kolkata',
    });
    await cal.drain();
    const ins = g.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/events'));
    expect((ins.at(-1)!.body as any).summary).toBe('Call with CA');
    const mine = (await mirror()).events.find((e) => e.id === id);
    expect(mine.externalId).toMatch(/^g\d+$/);
    // Google reports it back on the next sync: still one event
    const account = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@gmail.test',
    );
    await cal.poll(me.user.id, account.id);
    expect((await mirror()).events.filter((e) => e.title === 'Call with CA')).toHaveLength(1);
  });

  it('edits go with the etag; if Google changed it meanwhile, Google’s version wins everywhere', async () => {
    const dentist = (await mirror()).events.find((e) => e.externalId === 'dentist');
    await push(dentist.id, { location: 'Indiranagar' });
    await cal.drain();
    const patch = g.requests.filter((r) => r.method === 'PATCH').at(-1)!;
    expect(patch.ifMatch).toBe(dentist.etag);
    expect((patch.body as any).location).toBe('Indiranagar');

    g.put('asha@gmail.test', 'asha@gmail.test', { id: 'dentist', summary: 'Dentist (by Google)' });
    await push(dentist.id, { title: 'Dentist (by phone)' });
    await cal.drain();
    expect((await mirror()).events.find((e) => e.externalId === 'dentist').title).toBe('Dentist (by Google)');
  });

  it('cancelling or moving one occurrence of a Google series', async () => {
    const yoga = (await mirror()).events.find((e) => e.externalId === 'yoga');
    await push(yoga.id, { exdates: [...yoga.exdates, '2030-02-03T01:30:00.000Z'] });
    await cal.drain();
    expect(g.cal('asha@gmail.test', 'asha@gmail.test').events.get('yoga')!.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=SU',
      'EXDATE:20300113T013000Z',
      'EXDATE:20300203T013000Z',
    ]);
    const moved = v7();
    await push(moved, {
      title: 'Yoga',
      start: '2030-02-10T03:30:00.000Z',
      end: '2030-02-10T04:30:00.000Z',
      calendarId: yoga.calendarId,
      recurringEventId: yoga.id,
      originalStart: '2030-02-10T01:30:00.000Z',
    });
    await cal.drain();
    const inst = g.cal('asha@gmail.test', 'asha@gmail.test').events.get('yoga_20300210T013000Z')!;
    expect(inst).toMatchObject({ recurringEventId: 'yoga', start: { dateTime: '2030-02-10T03:30:00.000Z' } });
    expect((await mirror()).events.find((e) => e.id === moved).externalId).toBe('yoga_20300210T013000Z');
  });

  it('deleting on a phone deletes on Google', async () => {
    const call_ = (await mirror()).events.find((e) => e.title === 'Call with CA');
    await push(call_.id, {}, 'delete');
    await cal.drain();
    expect(g.cal('asha@gmail.test', 'asha@gmail.test').events.get(call_.externalId)!.status).toBe(
      'cancelled',
    );
  });
});

describe('when Google stops accepting, and disconnecting', () => {
  it('a revoked account is marked and the person is told once', async () => {
    g.revoked.add('rt-asha@work.test');
    const db = h.app.get<Db>(DB);
    await db.execute(sql`update calendar_accounts set access_expires_at = now() - interval '1 hour'`);
    const work = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@work.test',
    );
    await expect(cal.poll(me.user.id, work.id)).rejects.toThrow();
    const after = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@work.test',
    );
    expect(after.status).toBe('needs_reconnect');
    const notes = (await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body.items;
    expect(notes.filter((n: any) => n.title === 'Reconnect Google Calendar')).toHaveLength(1);
  });

  it('disconnecting removes that account’s calendars and events from every device, and revokes access', async () => {
    const gmail = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body.find(
      (a: any) => a.email === 'asha@gmail.test',
    );
    expect(
      (await call(h, 'DELETE', `/calendar/accounts/${gmail.id}`, { token: me.accessToken })).status,
    ).toBe(200);
    const m = await mirror();
    expect(m.calendars.map((c) => c.name).sort()).toEqual(['Holidays in India', 'Work']); // the work account's
    expect(m.events.some((e) => e.title.startsWith('Dentist'))).toBe(false);
    expect(g.revoked.has('rt-asha@gmail.test')).toBe(true);
  });

  it('someone else cannot see or remove my accounts', async () => {
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: me.accessToken,
      body: { email: 'friend@example.test', entitlements: ['today'] },
    });
    const friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] }))
      .body;
    expect((await call<any>(h, 'GET', '/calendar/accounts', { token: friend.accessToken })).body).toEqual([]);
    const work = (await call<any>(h, 'GET', '/calendar/accounts', { token: me.accessToken })).body[0];
    expect(
      (await call(h, 'DELETE', `/calendar/accounts/${work.id}`, { token: friend.accessToken })).status,
    ).toBe(404);
  });
});
