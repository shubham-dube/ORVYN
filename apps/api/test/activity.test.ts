import { randomUUID } from 'node:crypto';
import type { ActivitySpan, SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import { AiService } from '../src/modules/ai/ai.service';
import type { FakeModel } from '../src/modules/ai/fake.model';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let peer: SessionResponse;
let fake: FakeModel;
let db: Db;
const span = (o: Partial<ActivitySpan> = {}): ActivitySpan => ({
  id: randomUUID(),
  source: 'web',
  start: '2026-11-20T04:00:00Z',
  end: '2026-11-20T04:30:00Z',
  kind: 'active',
  app: 'chrome',
  host: 'github.com',
  path: '/orvyn/app/pull/7',
  title: 'Very private title',
  q: '',
  keys: 120,
  clicks: 4,
  scrolls: 9,
  ...o,
});
const push = (spans: unknown[], s = me) =>
  call(h, 'POST', '/activity/spans', { token: s.accessToken, body: { spans } });
const day = (date = '2026-11-20', s = me) =>
  call(h, 'GET', `/activity/day?date=${date}&tz=Asia/Kolkata`, { token: s.accessToken });

beforeAll(async () => {
  h = await startApp();
  me = (await signIn(h, OWNER)).body;
  db = h.app.get<Db>(DB);
  fake = h.app.get(AiService).model as FakeModel;
  const join = async (email: string, entitlements: string[]) => {
    const inv = await call(h, 'POST', '/admin/invites', {
      token: me.accessToken,
      body: { email, entitlements },
    });
    return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body;
  };
  friend = await join('friend@example.test', ['today']);
  peer = await join('peer@example.test', ['activity']);
});
afterAll(() => h.close());

describe('the activity record', () => {
  it('turns spans into a day; nothing readable is in the database (ADR-0018)', async () => {
    expect((await push([span()])).body.saved).toBe(1);
    const d = (await day()).body;
    expect(d.activeMs).toBe(30 * 60_000);
    expect(d.places[0]).toMatchObject({ place: 'GitHub', category: 'code' });
    expect(d.hours[9]).toBe(30 * 60_000); // 9:30 in India
    const raw = JSON.stringify(await db.execute(sql`select * from activity_spans`));
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('github');
  });

  it('a running span grows; a late old copy never shrinks it; resending adds nothing', async () => {
    const s = span({ start: '2026-11-19T04:00:00Z', end: '2026-11-19T04:10:00Z' });
    await push([s]);
    await push([{ ...s, end: '2026-11-19T04:40:00Z' }]);
    await push([s]);
    expect((await day('2026-11-19')).body.activeMs).toBe(40 * 60_000);
  });

  it('is cut at the person’s midnight and summed over days', async () => {
    await push([span({ start: '2026-11-17T18:00:00Z', end: '2026-11-17T19:00:00Z' })]); // 23:30–00:30 in India
    const r = await call(h, 'GET', '/activity/range?from=2026-11-17&to=2026-11-18&tz=Asia/Kolkata', {
      token: me.accessToken,
    });
    expect(r.body.map((d: { activeMs: number }) => d.activeMs)).toEqual([30 * 60_000, 30 * 60_000]);
  });

  it('refuses nonsense: end before start, over a day, the future, unknown zones and days', async () => {
    expect((await push([span({ end: '2026-11-20T03:00:00Z' })])).status).toBe(400);
    expect((await push([span({ end: '2026-11-22T03:00:00Z' })])).status).toBe(400);
    const soon = new Date(Date.now() + 5 * 3_600_000).toISOString();
    expect((await push([span({ start: soon, end: soon })])).body.saved).toBe(0);
    expect((await day('2026-02-31')).status).toBe(400);
    expect(
      (await call(h, 'GET', '/activity/day?date=2026-11-20&tz=Mars/Base', { token: me.accessToken })).status,
    ).toBe(400);
    expect(
      (await call(h, 'GET', '/activity/range?from=2026-01-01&to=2026-11-01', { token: me.accessToken }))
        .status,
    ).toBe(400);
  });

  it('is the person’s own: without the module nothing; with it, still only their own (AC8)', async () => {
    expect((await day('2026-11-20', friend)).status).toBe(403);
    expect((await push([span()], friend)).status).toBe(403);
    expect((await call(h, 'GET', '/activity/day?date=2026-11-20')).status).toBe(401);
    const mine = span({ start: '2026-11-16T04:00:00Z', end: '2026-11-16T04:30:00Z' });
    await push([mine]);
    const theirs = await push([{ ...mine, host: 'evil.test', end: '2026-11-16T05:30:00Z' }], peer);
    expect(theirs.body.saved).toBe(0); // an id is never taken over
    expect((await day('2026-11-16', peer)).body.activeMs).toBe(0);
    expect((await day('2026-11-16')).body.places[0].place).toBe('GitHub');
  });

  it('my rules change what a site counts as', async () => {
    await call(h, 'PUT', '/activity/rules', {
      token: me.accessToken,
      body: { categories: { 'github.com': 'learning' }, blocked: ['instagram.com'] },
    });
    expect((await day()).body.places[0].category).toBe('learning');
    expect((await call(h, 'GET', '/activity/rules', { token: me.accessToken })).body.blocked).toEqual([
      'instagram.com',
    ]);
  });

  it('writes the story only when asked, from names and durations', async () => {
    fake.handlers['activity.story'] = () => ({ story: 'You reviewed PR #7.', wins: ['Deep work'] });
    const r = await call(h, 'POST', '/activity/story', {
      token: me.accessToken,
      body: { date: '2026-11-20', tz: 'Asia/Kolkata' },
    });
    expect(r.body.story).toContain('PR #7');
    const sent = fake.calls.filter((c) => c.task === 'activity.story').at(-1)!.text;
    expect(sent).toContain('GitHub');
    expect(sent).not.toContain('/pull/');
    const empty = await call(h, 'POST', '/activity/story', {
      token: me.accessToken,
      body: { date: '2026-11-01', tz: 'Asia/Kolkata' },
    });
    expect(empty.body.story).toContain('not enough');
  });

  it('deletes a window, only mine', async () => {
    const r = await call(h, 'DELETE', '/activity?from=2026-11-20T00:00:00Z&to=2026-11-21T00:00:00Z', {
      token: me.accessToken,
    });
    expect(r.body.removed).toBe(1);
    expect((await day()).body.activeMs).toBe(0);
  });
});

describe('magic fill', () => {
  const profile = {
    facts: [
      { key: 'email', label: 'Email', value: 'me@secret-value.test', group: 'contact' },
      { key: 'email', label: 'Email', value: 'newer@secret-value.test', group: 'contact' },
    ],
    answers: [{ q: 'Notice period?', a: '30 days', host: 'x.test' }],
    story: 'I build apps.',
  };

  it('keeps the profile sealed, one value per key', async () => {
    const saved = await call(h, 'PUT', '/fill/profile', { token: me.accessToken, body: profile });
    expect(saved.status).toBe(200);
    const got = (await call(h, 'GET', '/fill/profile', { token: me.accessToken })).body;
    expect(got.facts).toEqual([profile.facts[1]]);
    expect(JSON.stringify(await db.execute(sql`select * from fill_profiles`))).not.toContain('secret-value');
    expect((await call(h, 'GET', '/fill/profile', { token: friend.accessToken })).status).toBe(403);
  });

  it('mapping takes no values and returns only known ids and keys (AC4)', async () => {
    const body = {
      fields: [{ id: 'f1', label: 'E-mail address' }],
      keys: [{ key: 'email', label: 'Email' }],
    };
    fake.handlers['fill.map'] = () => ({
      map: [
        { id: 'f1', key: 'email' },
        { id: 'zz', key: 'email' },
        { id: 'f1', key: 'invented' },
      ],
    });
    const r = await call(h, 'POST', '/fill/map', { token: me.accessToken, body });
    expect(r.body.map).toEqual([{ id: 'f1', key: 'email' }]);
    expect(fake.calls.at(-1)!.text).not.toContain('secret-value');
    const leaky = await call(h, 'POST', '/fill/map', {
      token: me.accessToken,
      body: { ...body, keys: [{ key: 'email', label: 'Email', value: 'me@x.test' }] },
    });
    expect(leaky.status).toBe(400);
  });

  it('reads a pasted profile into facts and drops bad ones; saves nothing', async () => {
    fake.handlers['fill.structure'] = () => ({
      facts: [
        { key: 'city', label: 'City', value: 'Pune', group: 'address' },
        { key: 'BAD KEY', label: 'x', value: 'y' },
        { key: 'empty', label: 'x', value: ' ' },
      ],
    });
    const r = await call(h, 'POST', '/fill/structure', {
      token: me.accessToken,
      body: { text: 'I am a person living in Pune, India.' },
    });
    expect(r.body.facts.map((f: { key: string }) => f.key)).toEqual(['city']);
    expect((await call(h, 'GET', '/fill/profile', { token: me.accessToken })).body.facts).toHaveLength(1);
  });

  it('drafts within the limit, from the profile; pages are read as data', async () => {
    fake.handlers['fill.draft'] = () => ({ answer: 'x'.repeat(500) });
    const r = await call(h, 'POST', '/fill/draft', {
      token: me.accessToken,
      body: { question: 'Why you?', maxChars: 100 },
    });
    expect(r.body.answer).toHaveLength(100);
    fake.handlers['page.read'] = () => ({ text: 'A page', actions: [{ kind: 'task', text: 'call mom' }] });
    const p = await call(h, 'POST', '/page/read', {
      token: me.accessToken,
      body: { mode: 'actions', pages: [{ url: 'https://x.test/a?token=abc', title: 'T', text: 'hello' }] },
    });
    expect(p.body.actions).toHaveLength(1);
    expect(fake.calls.at(-1)!.text).not.toContain('token=abc');
    expect(
      (
        await call(h, 'POST', '/page/read', {
          token: friend.accessToken,
          body: { mode: 'brief', pages: [{ url: 'https://x.test', text: 'a' }] },
        })
      ).status,
    ).toBe(403);
  });
});
