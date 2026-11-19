import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
const clock = new Hlc('ext');
const push = (s: SessionResponse, entity: string, fields: Record<string, unknown>, id = v7()) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const ymd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

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

describe('glances for small clients (spec 0007 C4)', () => {
  it('Today: overdue first, then today; nothing later, nothing done, nobody else’s', async () => {
    const now = new Date();
    await push(me, 'today.task', {
      title: 'Overdue thing',
      dueDate: ymd(new Date(now.getTime() - 3 * 864e5)),
    });
    await push(me, 'today.task', { title: 'Today thing', dueDate: ymd(now), priority: 2 });
    await push(me, 'today.task', { title: 'Next week', dueDate: ymd(new Date(now.getTime() + 7 * 864e5)) });
    await push(me, 'today.task', {
      title: 'Done already',
      dueDate: ymd(now),
      completedAt: now.toISOString(),
    });
    await push(friend, 'today.task', { title: 'Friend task', dueDate: ymd(now) });
    const g = (await call<any>(h, 'GET', '/today/glance', { token: me.accessToken })).body;
    expect(g.tasks.map((t: any) => [t.title, t.overdue])).toEqual([
      ['Overdue thing', true],
      ['Today thing', false],
    ]);
  });

  it('Money: this month’s totals without transfers, the latest entries, what waits for review', async () => {
    await call(h, 'POST', '/money/setup', { token: me.accessToken });
    const at = new Date().toISOString();
    await push(me, 'money.transaction', {
      amountMinor: 24000,
      direction: 'debit',
      occurredAt: at,
      merchant: 'Swiggy',
    });
    await push(me, 'money.transaction', {
      amountMinor: 500000,
      direction: 'debit',
      occurredAt: at,
      merchant: 'Me',
      transfer: true,
    });
    await push(me, 'money.transaction', {
      amountMinor: 18000,
      direction: 'debit',
      occurredAt: at,
      merchant: 'Uber',
      source: 'sms',
      reviewed: false,
    });
    const g = (await call<any>(h, 'GET', '/money/glance', { token: me.accessToken })).body;
    expect(g).toMatchObject({ spentMinor: 42000, earnedMinor: 0, toReview: 1 });
    expect(g.recent).toHaveLength(3);
    expect((await call(h, 'GET', '/money/glance', { token: friend.accessToken })).status).toBe(403);
  });

  it('Library: search by words in title, tags or text; only my documents', async () => {
    await push(me, 'library.doc', {
      kind: 'note',
      title: 'HDFC term insurance policy',
      tags: ['insurance'],
      text: 'premium due',
      status: 'ready',
    });
    await push(me, 'library.doc', {
      kind: 'note',
      title: 'Rent agreement',
      tags: ['home'],
      text: 'lease',
      status: 'ready',
    });
    const r = (await call<any>(h, 'GET', '/library/search?q=insurance premium', { token: me.accessToken }))
      .body;
    expect(r.map((d: any) => d.title)).toEqual(['HDFC term insurance policy']);
    expect((await call<any>(h, 'GET', '/library/search?q=', { token: me.accessToken })).body).toEqual([]);
    expect((await call(h, 'GET', '/library/search?q=rent', { token: friend.accessToken })).status).toBe(403);
  });
});
