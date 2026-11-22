import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
const clock = new Hlc('dev');
let cats: Record<string, string> = {};

const push = (s: SessionResponse, entity: string, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const row = async (id: string) =>
  (
    (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: me.accessToken })).body.changes as any[]
  ).findLast((c) => c.entity === 'money.transaction' && c.entityId === id).data;

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['money'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
  await call(h, 'POST', '/money/setup', { token: me.accessToken });
  const pulled = (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: me.accessToken })).body
    .changes as any[];
  cats = Object.fromEntries(
    pulled.filter((c) => c.entity === 'money.category').map((c) => [c.data.slug, c.entityId]),
  );
});
afterAll(() => h.close());

describe('the money brain (spec 0013)', () => {
  it('a captured payment to a merchant always filed the same way is filed without asking', async () => {
    // three Blue Tokai payments filed as food, typed in by hand
    for (const d of [20, 12, 5])
      await push(me, 'money.transaction', v7(), {
        amountMinor: 31_000,
        occurredAt: daysAgo(d),
        merchant: 'Blue Tokai',
        categoryId: cats.food,
        source: 'manual',
      });
    const id = v7();
    await push(me, 'money.transaction', id, {
      amountMinor: 29_000,
      occurredAt: daysAgo(0.01),
      merchant: 'Blue Tokai',
      rawMerchant: 'BLUE TOKAI COFFEE',
      source: 'sms',
      reviewed: false,
    });
    const t = await row(id);
    expect(t).toMatchObject({ categoryId: cats.food, reviewed: true });
    const inbox = (await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body
      .items as any[];
    expect(inbox.find((n) => n.kind === 'filed' && /Blue Tokai/.test(n.title)).body).toMatch(
      /like your last 3 payments/,
    );
  });

  it('insights: pace, an unusual charge and a double charge — the friend sees only their own', async () => {
    const month = new Date().toISOString().slice(0, 7);
    for (const d of [25, 18, 11, 4])
      await push(me, 'money.transaction', v7(), {
        amountMinor: 35_000,
        occurredAt: daysAgo(d),
        merchant: 'Swiggy',
        categoryId: cats.food,
      });
    const big = v7();
    await push(me, 'money.transaction', big, {
      amountMinor: 240_000,
      occurredAt: daysAgo(0.02),
      merchant: 'Swiggy',
      categoryId: cats.food,
    });
    for (const id of [v7(), v7()])
      await push(me, 'money.transaction', id, {
        amountMinor: 23_000,
        occurredAt: daysAgo(0.03),
        merchant: 'Uber',
      });
    const r = (await call<any>(h, 'GET', `/money/insights?month=${month}`, { token: me.accessToken })).body;
    expect(r.pace).toMatchObject({ month, budgetMinor: null, safePerDayMinor: null });
    expect(r.pace.spentMinor).toBeGreaterThan(0);
    expect(r.cards.find((c: any) => c.kind === 'unusual')).toMatchObject({
      merchant: 'Swiggy',
      txIds: [big],
    });
    expect(r.cards.find((c: any) => c.kind === 'duplicate')).toMatchObject({ merchant: 'Uber' });

    const theirs = (
      await call<any>(h, 'GET', `/money/insights?month=${month}`, { token: friend.accessToken })
    ).body;
    expect(theirs.pace.spentMinor).toBe(0);
    expect(theirs.cards).toEqual([]);
    expect((await call(h, 'GET', '/money/insights?month=2026-13', { token: me.accessToken })).status).toBe(
      400,
    );
  });
});
