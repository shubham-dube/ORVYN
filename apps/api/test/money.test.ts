import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let guest: SessionResponse;
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
const pull = async (s: SessionResponse) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[]).filter(
    (c) => c.entity.startsWith('money.'),
  );
const invite = async (email: string, ent: string[]) => {
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email, entitlements: ent },
  });
  return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body as SessionResponse;
};

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  friend = await invite('friend@example.test', ['money']);
  guest = await invite('guest@example.test', ['today']);
});
afterAll(() => h.close());

describe('Money over sync (spec 0003)', () => {
  it('starting categories once per person, on every device; asking again adds nothing', async () => {
    expect((await call<any>(h, 'POST', '/money/setup', { token: me.accessToken })).body).toEqual({
      created: 21,
    });
    expect((await call<any>(h, 'POST', '/money/setup', { token: me.accessToken })).body).toEqual({
      created: 0,
    });
    const cats = (await pull(me)).filter((c) => c.entity === 'money.category');
    expect(cats).toHaveLength(21);
    expect(cats.find((c) => c.data.slug === 'food').data).toMatchObject({
      name: 'Food & dining',
      kind: 'expense',
    });
    expect((await call<any>(h, 'POST', '/money/setup', { token: friend.accessToken })).body).toEqual({
      created: 21,
    });
  });

  it('a captured transaction, and the same payment again is refused as a duplicate (AC2)', async () => {
    const food = (await pull(me)).find((c) => c.data?.slug === 'food').entityId;
    const acct = v7();
    await push(me, 'money.account', acct, {
      name: 'HDFC Savings',
      kind: 'bank',
      last4: '1234',
      institution: 'HDFC',
    });
    const tx = {
      amountMinor: 24000,
      direction: 'debit',
      occurredAt: '2026-11-17T08:00:00.000Z',
      merchant: 'Swiggy',
      rawMerchant: 'SWIGGY',
      categoryId: food,
      accountId: acct,
      source: 'sms',
      dedupeKey: 'ref:432112345678',
      refNo: '432112345678',
      reviewed: false,
    };
    const id = v7();
    expect(await rejected(push(me, 'money.transaction', id, tx))).toBeUndefined();
    expect(await rejected(push(me, 'money.transaction', v7(), { ...tx, source: 'notification' }))).toBe(
      'duplicate',
    );
    // editing the original is fine; someone else may have the same reference
    expect(
      await rejected(push(me, 'money.transaction', id, { reviewed: true, note: 'team lunch' })),
    ).toBeUndefined();
    expect(
      await rejected(push(friend, 'money.transaction', v7(), { ...tx, categoryId: null, accountId: null })),
    ).toBeUndefined();
    // deleted → the same payment can be recorded again (undo, D20)
    await push(me, 'money.transaction', id, {}, 'delete');
    expect(await rejected(push(me, 'money.transaction', v7(), tx))).toBeUndefined();
  });

  it('amounts are whole paise and positive; only my own categories and accounts', async () => {
    const base = { occurredAt: '2026-11-17T08:00:00.000Z' };
    expect(await rejected(push(me, 'money.transaction', v7(), { ...base, amountMinor: 0 }))).toMatch(
      /invalid/,
    );
    expect(await rejected(push(me, 'money.transaction', v7(), { ...base, amountMinor: 12.5 }))).toMatch(
      /invalid/,
    );
    const myCategory = (await pull(me)).find((c) => c.data?.slug === 'rent').entityId;
    expect(
      await rejected(
        push(friend, 'money.transaction', v7(), { ...base, amountMinor: 100, categoryId: myCategory }),
      ),
    ).toBe('unknown category');
    expect(
      await rejected(
        push(friend, 'money.budget', v7(), { amountMinor: 100, from: '2026-11', categoryId: myCategory }),
      ),
    ).toBe('unknown category');
  });

  it('nobody reads another person’s money; without Money the server refuses (AC6)', async () => {
    const mine = await pull(me);
    const theirs = await pull(friend);
    const mineIds = new Set(mine.map((c) => c.entityId));
    expect(theirs.some((c) => mineIds.has(c.entityId))).toBe(false);
    expect(
      await rejected(
        push(guest, 'money.transaction', v7(), { amountMinor: 100, occurredAt: '2026-11-17T08:00:00.000Z' }),
      ),
    ).toBe('feature_not_enabled');
    expect((await call(h, 'POST', '/money/setup', { token: guest.accessToken })).status).toBe(403);
  });
});
