import { Hlc, type SessionResponse, STARTING_SETTINGS } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let phone: SessionResponse;
let laptop: SessionResponse;
let friend: SessionResponse; // has `today`
let guest: SessionResponse; // doesn't
const clockA = new Hlc('phone');
const clockB = new Hlc('laptop');
const clockF = new Hlc('friend');

const push = (s: SessionResponse, mutations: unknown[]) =>
  call<any>(h, 'POST', '/sync/push', { token: s.accessToken, body: { mutations } });
const pullAll = async (s: SessionResponse) =>
  (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body;
const up = (entity: string, entityId: string, fields: Record<string, unknown>, hlc: string) => ({
  mutationId: v7(),
  entity,
  entityId,
  op: 'upsert',
  fields,
  hlc,
});
const task = (id: string, fields: Record<string, unknown>, clock = clockA) =>
  up('today.task', id, fields, clock.tick());

async function invite(email: string, entitlements: string[]) {
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: phone.accessToken,
    body: { email, entitlements },
  });
  return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body;
}

beforeAll(async () => {
  h = await startApp();
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
  laptop = (await signIn(h, OWNER, { platform: 'windows' })).body;
  friend = await invite('friend@example.test', ['today']);
  guest = await invite('guest@example.test', ['chat']);
});
afterAll(() => h.close());

describe('Today: projects and tasks over sync', () => {
  it('a task with a project, due moment and reminders round-trips with defaults filled in', async () => {
    const project = v7();
    const id = v7();
    const r = await push(phone, [
      up('today.project', project, { name: 'Home', colour: 'emerald' }, clockA.tick()),
      task(id, {
        title: 'Pay rent',
        projectId: project,
        dueAt: '2026-12-01T10:00:00+05:30',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
        reminders: [{ kind: 'before', minutes: 60 }],
        priority: 3,
      }),
    ]);
    expect(r.body.rejected).toEqual([]);
    const changes = (await pullAll(laptop)).changes as any[];
    const t = changes.find((c) => c.entityId === id).data;
    expect(t).toMatchObject({
      title: 'Pay rent',
      projectId: project,
      dueAt: '2026-12-01T04:30:00.000Z', // stored as an instant
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
      priority: 3,
      notes: '',
      tags: [],
      completedAt: null,
      timeZone: 'Asia/Kolkata',
    });
    expect(changes.find((c) => c.entityId === project).data).toMatchObject({
      name: 'Home',
      colour: 'emerald',
      archived: false,
    });
  });

  it('phone completes while the laptop renames: both survive (per-field merge)', async () => {
    const id = v7();
    await push(phone, [task(id, { title: 'Buy milk' })]);
    await push(laptop, [task(id, { title: 'Buy oat milk' }, clockB)]);
    await push(phone, [task(id, { completedAt: '2026-11-16T09:00:00Z' })]);
    const t = ((await pullAll(phone)).changes as any[]).filter((c) => c.entityId === id).at(-1).data;
    expect([t.title, t.completedAt]).toEqual(['Buy oat milk', '2026-11-16T09:00:00.000Z']);
  });

  it('refuses bad fields without failing the rest of the push', async () => {
    const good = v7();
    const r = await push(phone, [
      task(v7(), { title: '' }),
      task(v7(), { title: 'x', priority: 9 }),
      task(v7(), { title: 'x', dueAt: 'tomorrow' }),
      task(v7(), { title: 'x', hacker: true }),
      task(good, { title: 'Fine' }),
    ]);
    expect(r.body.rejected).toHaveLength(4);
    expect(r.body.applied).toHaveLength(1);
  });

  it("a person's data is theirs alone", async () => {
    const mine = v7();
    await push(phone, [task(mine, { title: 'Private' })]);
    // the friend can't read it…
    const theirs = (await pullAll(friend)).changes as any[];
    expect(theirs.some((c) => c.entityId === mine)).toBe(false);
    // …or overwrite it by guessing the id
    const hijack = await push(friend, [task(mine, { title: 'Owned' }, clockF)]);
    expect(hijack.body.applied).toHaveLength(0);
    const still = ((await pullAll(phone)).changes as any[]).filter((c) => c.entityId === mine).at(-1).data;
    expect(still.title).toBe('Private');
    // …or file their task under the owner's project
    const ownerProject = ((await pullAll(phone)).changes as any[]).find(
      (c) => c.entity === 'today.project',
    ).entityId;
    const sneaky = await push(friend, [task(v7(), { title: 'x', projectId: ownerProject }, clockF)]);
    expect(sneaky.body.rejected[0].reason).toBe('unknown project');
  });

  it('without the Today switch nothing syncs', async () => {
    const r = await push(guest, [task(v7(), { title: 'Nope' }, clockF)]);
    expect(r.body.applied).toHaveLength(0);
    expect(r.body.rejected).toHaveLength(1);
    const pulled = (await pullAll(guest)).changes as any[];
    expect(pulled.filter((c) => c.entity.startsWith('today.'))).toEqual([]);
  });

  it('delete is a tombstone; re-creating the same id brings it back', async () => {
    const id = v7();
    await push(phone, [task(id, { title: 'Temp' })]);
    await push(phone, [
      { mutationId: v7(), entity: 'today.task', entityId: id, op: 'delete', fields: {}, hlc: clockA.tick() },
    ]);
    let last = ((await pullAll(laptop)).changes as any[]).filter((c) => c.entityId === id).at(-1);
    expect(last.op).toBe('delete');
    await push(phone, [task(id, { title: 'Back' })]);
    last = ((await pullAll(laptop)).changes as any[]).filter((c) => c.entityId === id).at(-1);
    expect([last.op, last.data.title]).toEqual(['upsert', 'Back']);
  });
});

describe('Today settings: one record per person, theirs to change (D16, D17)', () => {
  const settings = (s: SessionResponse, id: string, fields: Record<string, unknown>, clock = clockA) =>
    push(s, [up('today.settings', id, fields, clock.tick())]);

  it('saves the full settings once, then single fields', async () => {
    const id = phone.user.id;
    expect((await settings(phone, id, STARTING_SETTINGS)).body.rejected).toEqual([]);
    const later = {
      validFrom: '2026-12-01',
      week: { mon: [{ start: '09:00', end: '17:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    };
    await settings(phone, id, { patterns: [...STARTING_SETTINGS.patterns, later] });
    await settings(
      laptop,
      id,
      { reminders: { timed: [1440, 10], dateOnly: { mode: 'none' }, overdueInDigest: false } },
      clockB,
    );
    const row = ((await pullAll(laptop)).changes as any[])
      .filter((c) => c.entity === 'today.settings')
      .at(-1).data;
    expect(row.patterns).toHaveLength(2);
    expect(row.reminders).toEqual({ timed: [1440, 10], dateOnly: { mode: 'none' }, overdueInDigest: false });
    expect(row.bufferMin).toBe(15);
  });

  it('refuses a first save that is incomplete, and invalid values', async () => {
    const r = await settings(friend, friend.user.id, { bufferMin: 10 }, clockF);
    expect(r.body.rejected).toHaveLength(1);
    const overlap = await settings(phone, phone.user.id, {
      dayOverrides: [
        {
          date: '2026-12-24',
          ranges: [
            { start: '10:00', end: '13:00' },
            { start: '12:00', end: '14:00' },
          ],
        },
      ],
    });
    expect(overlap.body.rejected[0].reason).toMatch(/overlap/);
  });

  it("nobody can write someone else's settings", async () => {
    const r = await settings(friend, phone.user.id, STARTING_SETTINGS, clockF);
    expect(r.body.applied).toHaveLength(0);
    const odd = await settings(friend, v7(), STARTING_SETTINGS, clockF);
    expect(odd.body.rejected[0].reason).toBe('settings id must be your own id');
  });
});

describe('POST /today/parse (for Android)', () => {
  it("uses the person's projects and returns chips", async () => {
    const project = v7();
    await push(phone, [up('today.project', project, { name: 'Garden' }, clockA.tick())]);
    const r = await call<any>(h, 'POST', '/today/parse', {
      token: phone.accessToken,
      body: { text: 'water roses @garden every day 7am #plants' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      title: 'Water roses',
      rrule: 'FREQ=DAILY',
      projectId: project,
      tags: ['plants'],
    });
    expect(r.body.dueAt).toMatch(/T01:30:00\.000Z$/); // 07:00 in Asia/Kolkata
    expect(r.body.spans.map((s: { kind: string }) => s.kind)).toEqual(
      expect.arrayContaining(['repeat', 'time', 'project', 'tag']),
    );
  });

  it("never sees someone else's projects, and needs the Today switch", async () => {
    const r = await call<any>(h, 'POST', '/today/parse', {
      token: friend.accessToken,
      body: { text: 'x @garden' },
    });
    expect([r.body.projectId, r.body.projectName]).toEqual([null, 'garden']);
    expect(
      (await call(h, 'POST', '/today/parse', { token: guest.accessToken, body: { text: 'x' } })).status,
    ).toBe(403);
    expect(
      (await call(h, 'POST', '/today/parse', { token: phone.accessToken, body: { text: '' } })).status,
    ).toBe(400);
  });
});
