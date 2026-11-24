import { Hlc, type SessionResponse, STARTING_SETTINGS } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiService } from '../src/modules/ai/ai.service';
import type { FakeModel } from '../src/modules/ai/fake.model';
import { BriefOutside } from '../src/modules/brief/brief.outside';
import { BriefService } from '../src/modules/brief/brief.service';
import { ConnectionsService } from '../src/modules/connections/connections.service';
import { IpoService } from '../src/modules/ipo/ipo.service';
import { RemindersService } from '../src/modules/today/reminders.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let brief: BriefService;
let outside: BriefOutside;
let fake: FakeModel;
const clock = new Hlc('dev');

/** "Today" is two days from now, 09:30 in Kolkata; everything is placed around it. */
const real = new Date();
const D = new Date(Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate() + 2, 4, 0));
const day = (offset: number) => new Date(D.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = day(0);
const at = (offsetDays: number, hhmmIst: string) => {
  const [hh, mm] = hhmmIst.split(':').map(Number) as [number, number];
  const t = new Date(`${day(offsetDays)}T00:00:00Z`).getTime() + (hh * 60 + mm - 330) * 60_000;
  return new Date(t).toISOString();
};

const push = (who: SessionResponse, entity: string, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: who.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const get = async (who: SessionResponse, path: string) =>
  (await call<any>(h, 'GET', path, { token: who.accessToken })).body;
const inbox = async (who: SessionResponse, module = 'brief') =>
  ((await get(who, '/notifications')).items as any[]).filter((n) => n.module === module);
/** each task as it stands now: the last change for each id */
const tasks = async (who: SessionResponse) => {
  const latest = new Map<string, any>();
  for (const c of (await get(who, '/sync/pull?cursor=0')).changes as any[])
    if (c.entity === 'today.task') latest.set(c.entityId, c);
  return [...latest.values()].map((c) => ({ ...c, fields: c.fields ?? c.data ?? {} }));
};

beforeAll(async () => {
  h = await startApp();
  brief = h.app.get(BriefService);
  brief.now = () => D.getTime() + 3_600_000; // 10:30 IST
  // nothing from outside in tests unless a test says so; the AI declines to write until a test asks it to
  outside = h.app.get(BriefOutside);
  outside.weather = async () => null;
  outside.markets = async () => null;
  fake = h.app.get(AiService).model as FakeModel;
  fake.handlers['brief.write'] = () => {
    throw new Error('not now');
  };
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['today', 'brief'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;

  await push(me, 'today.settings', me.user.id, {
    ...STARTING_SETTINGS,
    timeZone: 'Asia/Kolkata',
    reminders: { timed: [10], dateOnly: { mode: 'digest', at: '09:00' }, overdueInDigest: true },
  });
  await push(me, 'today.task', v7(), { title: 'Ship release notes', dueDate: TODAY, priority: 3 });
  await push(me, 'today.task', v7(), { title: 'Buy milk', dueDate: TODAY });
  for (const t of ['Renew passport', 'Call the bank', 'Pay the plumber'])
    await push(me, 'today.task', v7(), { title: t, dueDate: day(-3) });
  await push(me, 'today.task', v7(), { title: 'Later thing', dueDate: day(5) });
  await push(me, 'today.event', v7(), {
    title: 'Standup',
    start: at(0, '11:00'),
    end: at(0, '11:15'),
    timeZone: 'Asia/Kolkata',
  });
  await push(me, 'today.event', v7(), {
    title: 'Design review',
    start: at(0, '15:00'),
    end: at(0, '16:00'),
    timeZone: 'Asia/Kolkata',
  });
  const food = v7();
  await push(me, 'money.category', food, { name: 'Food', kind: 'expense' });
  await push(me, 'money.budget', v7(), { categoryId: food, amountMinor: 1_000_000, from: TODAY.slice(0, 7) });
  await push(me, 'money.transaction', v7(), {
    amountMinor: 900_000,
    occurredAt: at(-1, '13:00'),
    merchant: 'Big dinner',
    categoryId: food,
  });
  await push(me, 'library.doc', v7(), {
    kind: 'note',
    title: 'Car insurance',
    expiresOn: day(10),
    status: 'ready',
  });
  // the friend has their own life
  await push(friend, 'today.task', v7(), { title: 'Friend secret task', dueDate: TODAY });
});
afterAll(() => h.close());

describe('the Brief (spec 0009)', () => {
  it('shows today in order, from the person’s own data and only their modules (AC1)', async () => {
    const b = await get(me, '/brief/today');
    expect(b.day).toBe(TODAY);
    expect(b.headline).toBe('2 meetings, 2 tasks, 3 overdue · first at 11:00');
    const agenda = b.sections.find((s: any) => s.kind === 'agenda');
    expect(agenda.events.map((e: any) => e.title)).toEqual(['Standup', 'Design review']);
    expect(agenda.top[0]).toMatchObject({ title: 'Ship release notes', priority: 3 });
    const money = b.sections.find((s: any) => s.kind === 'money');
    expect(money).toMatchObject({
      yesterdayMinor: 900_000,
      budgets: [{ name: 'Food', spentMinor: 900_000 }],
    });
    expect(b.sections.find((s: any) => s.kind === 'library').expiring[0]).toMatchObject({
      title: 'Car insurance',
      days: 10,
    });
    expect(JSON.stringify(b)).not.toContain('Friend secret task');

    const theirs = await get(friend, '/brief/today');
    // no Money, Drop or Library for them; their own focus and agenda
    expect(theirs.sections.map((s: any) => s.kind)).toEqual(['focus', 'agenda']);
    expect(JSON.stringify(theirs)).toContain('Friend secret task');
    expect(JSON.stringify(theirs)).not.toContain('Standup');
  });

  it('from your tools: what I’m working on in ClickUp, as Today shows it, and the reviews waiting (spec 0018)', async () => {
    const c = h.app.get(ConnectionsService);
    const task = (id: string, name: string, status: string, working: boolean, due: string | null) =>
      ({
        id,
        name,
        status,
        statusColor: '#7c3aed',
        working,
        list: 'App',
        due,
        url: `https://app.clickup.com/t/${id}`,
      }) as any;
    const [cu, gh] = [c.clickupTasks, c.githubWork];
    c.clickupTasks = async () => [
      task('t1', 'Payment screen', 'development', true, at(1, '18:00')),
      task('t2', 'Onboarding art', 'design', true, at(-2, '18:00')),
      task('t3', 'Old ticket', 'backlog', false, null),
    ];
    c.githubWork = async () =>
      [
        {
          kind: 'issue',
          title: 'Crash on login',
          repo: 'acme/app',
          number: 7,
          url: 'https://github.com/acme/app/issues/7',
        },
        {
          kind: 'review',
          title: 'Add payments',
          repo: 'acme/app',
          number: 9,
          url: 'https://github.com/acme/app/pull/9',
        },
      ] as any;
    try {
      const w = (await brief.build(me.user.id)).sections.find((x) => x.kind === 'work') as any;
      // the working ones only, soonest first; the overdue one says so
      expect(w.tasks.map((t: any) => [t.name, t.status, t.overdue])).toEqual([
        ['Onboarding art', 'design', true],
        ['Payment screen', 'development', false],
      ]);
      expect(w.clickup).toBe(3);
      expect(w.github.map((g: any) => g.kind)).toEqual(['review', 'issue']);
    } finally {
      c.clickupTasks = cu;
      c.githubWork = gh;
    }
  });

  it('without the Brief module the server refuses', async () => {
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: me.accessToken,
      body: { email: 'nobrief@example.test', entitlements: ['today'] },
    });
    const other = (await signIn(h, 'nobrief@example.test', { invite: inv.body.link.split('/join/')[1] }))
      .body;
    expect((await call(h, 'GET', '/brief/today', { token: other.accessToken })).status).toBe(403);
  });

  it('off sends nothing; on, it is sent once, and Today’s summary steps aside (AC2, AC3)', async () => {
    expect(await get(me, '/brief/settings')).toMatchObject({ enabled: false, at: '07:30' });
    expect(await brief.send(me.user.id)).toBe(false);
    expect(await inbox(me)).toEqual([]);

    const saved = await call<any>(h, 'PUT', '/brief/settings', {
      token: me.accessToken,
      body: { enabled: true, at: '07:30' },
    });
    expect(saved.body.nudges).toEqual({
      enabled: true,
      kinds: ['slipped', 'budget', 'payments', 'drop'],
      max: 2,
    });
    expect(await brief.send(me.user.id)).toBe(true);
    expect(await brief.send(me.user.id)).toBe(false);
    const sent = await inbox(me);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: 'Good morning — 2 meetings, 2 tasks, 3 overdue · first at 11:00',
      url: '/brief',
    });
    expect(sent[0].body).toContain('Standup 11:00');

    await h.app.get(RemindersService).digest(me.user.id);
    expect((await inbox(me, 'today')).filter((n) => n.kind === 'digest')).toEqual([]);
  });

  it('nudges: within the cap, never twice for the same reason; Move to today moves the slipped tasks (AC4, AC5)', async () => {
    expect(await brief.nudge(me.user.id)).toBe(2); // slipped + budget (cap 2)
    const nudges = (await inbox(me)).filter((n) => n.kind === 'nudge');
    expect(nudges.map((n) => n.title).sort()).toEqual(['3 things slipped', 'Food: 90% of the budget'].sort());
    expect(await brief.nudge(me.user.id)).toBe(0);

    const slipped = nudges.find((n) => n.title === '3 things slipped');
    expect((await tasks(me)).filter((t) => t.fields.dueDate === TODAY)).toHaveLength(2); // nothing moved yet
    const r = await call(h, 'POST', `/notifications/${slipped.id}/actions/move_today`, {
      token: me.accessToken,
      body: {},
    });
    expect(r.status).toBeLessThan(300);
    const moved = (await tasks(me)).filter((t) => t.fields.dueDate === TODAY).map((t) => t.fields.title);
    expect(moved.sort()).toEqual([
      'Buy milk',
      'Call the bank',
      'Pay the plumber',
      'Renew passport',
      'Ship release notes',
    ]);
  });

  it('nudges stay quiet outside the window, and each kind can be switched off', async () => {
    await brief.forgetNudges(me.user.id);
    const before = brief.now;
    brief.now = () => D.getTime() + 12 * 3_600_000; // 21:30 IST
    expect(await brief.nudge(me.user.id)).toBe(0);
    brief.now = before;
    await call(h, 'PUT', '/brief/settings', {
      token: me.accessToken,
      body: { enabled: true, at: '07:30', nudges: { enabled: true, kinds: ['drop'], max: 2 } },
    });
    expect(await brief.nudge(me.user.id)).toBe(0); // the budget is still at 90%, but budget nudges are off
  });

  it('keeps a week of Briefs', async () => {
    const hist = await get(me, '/brief/history?days=7');
    expect(hist.map((b: any) => b.day)).toEqual([TODAY]);
  });
});

describe('the Brief with a brain (spec 0016 B)', () => {
  it('weather, markets, focus with free slots, money due, IPOs closing — and the AI’s opening (AC4, AC5)', async () => {
    const settings = await get(me, '/brief/settings');
    await call(h, 'PUT', '/brief/settings', {
      token: me.accessToken,
      body: { ...settings, place: { name: 'Bengaluru, Karnataka, India', lat: 12.97, lon: 77.59 } },
    });
    outside.weather = async (place) => ({
      kind: 'weather',
      place: place.name.split(',')[0]!,
      now: 24,
      feels: 25,
      high: 29,
      low: 19,
      rain: 70,
      code: 61,
      sky: 'Light rain',
      sunrise: '06:21',
      sunset: '17:49',
      advice: 'Rain likely from 4 pm — carry an umbrella.',
    });
    outside.markets = async () => ({
      kind: 'markets',
      items: [{ name: 'Nifty 50', last: 25349.65, changePct: -1.75 }],
      at: null,
    });
    let facts = '';
    fake.handlers['brief.write'] = (text) => {
      facts = text;
      return {
        story: 'Two meetings, and the release notes come first.',
        tip: 'Use 11:15 to 12:15 for them.',
      };
    };
    // a debt due tomorrow, and an IPO I plan to apply for that closes today
    await push(me, 'money.iou', v7(), {
      person: 'Ravi',
      direction: 'i_owe',
      amountMinor: 250_000,
      dueDate: day(1),
      startedAt: at(-5, '10:00'),
    });
    const ipo = h.app.get(IpoService);
    await ipo.upsert({
      slug: 'mega-ipo',
      name: 'Mega Power',
      type: 'mainboard',
      status: 'open',
      openDate: day(-2),
      closeDate: TODAY,
      allotmentDate: day(1),
      refundDate: null,
      listingDate: day(3),
      priceMin: 140,
      priceMax: 148,
      lotSize: 101,
      issueSizeCr: 1000,
      gmp: 40,
      gmpUpdatedAt: null,
      subscription: null,
      listingPrice: null,
      url: null,
    });
    const mega = (await get(me, '/ipo/issues')).issues.find((i: any) => i.name === 'Mega Power');
    await call(h, 'PUT', `/ipo/issues/${mega.id}/decision`, {
      token: me.accessToken,
      body: { decision: 'applying' },
    });

    const b = (await call<any>(h, 'POST', '/brief/today/refresh', { token: me.accessToken })).body;
    expect(b.greeting).toMatch(/^Good morning/);
    expect(b.story).toBe('Two meetings, and the release notes come first.');
    expect(b.tip).toBe('Use 11:15 to 12:15 for them.');
    // the AI was given the Brief's facts — this person's only
    expect(facts).toContain('Ship release notes');
    expect(facts).not.toContain('Friend secret task');
    expect(b.sections.map((x: any) => x.kind).slice(0, 4)).toEqual(['weather', 'focus', 'agenda', 'ipo']);
    expect(b.sections.find((x: any) => x.kind === 'weather')).toMatchObject({ sky: 'Light rain', high: 29 });
    expect(b.sections.find((x: any) => x.kind === 'markets').items[0]).toMatchObject({ name: 'Nifty 50' });

    // your three: the high-priority task first, in the first free stretch it fits (after the 11:00 standup)
    const focus = b.sections.find((x: any) => x.kind === 'focus');
    expect(focus.items[0]).toMatchObject({ title: 'Ship release notes', minutes: 60, planned: false });
    expect(focus.items[0].slot).toEqual({ start: at(0, '11:15'), end: at(0, '12:15') });
    expect(focus.free[0]).toEqual({ start: at(0, '10:30'), end: at(0, '11:00') });

    expect(b.sections.find((x: any) => x.kind === 'ipo').items[0]).toMatchObject({
      name: 'Mega Power',
      today: 'closes',
      decision: 'applying',
      lotAmount: 14948,
      gainPerLot: 4040,
    });
    expect(b.line).toContain('Last day: Mega Power IPO');
    const money = b.sections.find((x: any) => x.kind === 'money');
    expect(money.dues).toEqual([{ title: 'Pay back Ravi', amountMinor: 250_000, on: day(1), kind: 'pay' }]);

    // Plan it: the task takes its slot, through sync
    const planned = (
      await call<any>(h, 'POST', '/brief/plan', {
        token: me.accessToken,
        body: { taskId: focus.items[0].id, start: focus.items[0].slot.start, minutes: 60 },
      })
    ).body;
    expect(planned.sections.find((x: any) => x.kind === 'focus').items[0]).toMatchObject({
      title: 'Ship release notes',
      planned: true,
    });
    const t = (await tasks(me)).find((x) => x.entityId === focus.items[0].id);
    expect(t.fields).toMatchObject({ scheduledStart: at(0, '11:15'), durationMin: 60 });
    // someone else's task can't be planned
    expect(
      (
        await call(h, 'POST', '/brief/plan', {
          token: friend.accessToken,
          body: { taskId: focus.items[0].id, start: at(0, '13:00'), minutes: 30 },
        })
      ).status,
    ).toBe(404);
  });

  it('without AI, or when the weather can’t be read, it still builds (AC5)', async () => {
    fake.handlers['brief.write'] = () => {
      throw new Error('down');
    };
    outside.weather = async () => null;
    const b = (await call<any>(h, 'POST', '/brief/today/refresh', { token: me.accessToken })).body;
    expect(b.story).toBeNull();
    expect(b.headline).toContain('meeting');
    expect(b.sections.some((x: any) => x.kind === 'weather')).toBe(false);
    const off = await get(me, '/brief/settings');
    await call(h, 'PUT', '/brief/settings', { token: me.accessToken, body: { ...off, ai: false } });
    fake.calls.length = 0;
    await call(h, 'POST', '/brief/today/refresh', { token: me.accessToken });
    expect(fake.calls.filter((c) => c.task === 'brief.write')).toEqual([]);
  });
});
