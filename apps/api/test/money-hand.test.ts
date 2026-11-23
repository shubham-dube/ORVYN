import { type SessionResponse, Hlc } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

// What's in my hand, who owes whom, and money in that waits for a yes (spec 0014).
let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
const clock = new Hlc('dev');

const push = (who: SessionResponse, entity: string, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: who.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const pulled = async (who: SessionResponse, entity: string, id: string) =>
  (
    (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: who.accessToken })).body.changes as any[]
  ).findLast((c) => c.entity === entity && c.entityId === id);
const asks = async () =>
  ((await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body.items as any[]).filter(
    (n) => n.module === 'money' && n.kind === 'review' && !n.dismissedAt,
  );
const act = (n: any, action: string) =>
  call<any>(h, 'POST', `/notifications/${n.id}/actions/${action}`, { token: me.accessToken, body: {} });

async function credit(merchant: string, amountMinor: number) {
  const id = v7();
  await push(me, 'money.transaction', id, {
    amountMinor,
    direction: 'credit',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    merchant,
    rawMerchant: merchant.toUpperCase(),
    source: 'sms',
    reviewed: false,
  });
  return id;
}

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  await call(h, 'POST', '/money/setup', { token: me.accessToken });
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['money'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(() => h.close());

describe('who owes whom (spec 0014)', () => {
  it('a debt syncs like everything else, and only its owner sees it (rule 5)', async () => {
    const id = v7();
    const r = await push(me, 'money.iou', id, {
      person: 'Rahul',
      direction: 'owed_to_me',
      amountMinor: 500000,
      note: 'Cash for his rent',
      startedAt: new Date().toISOString(),
    });
    expect(r.status).toBe(200);
    expect((await pulled(me, 'money.iou', id)).data).toMatchObject({
      person: 'Rahul',
      paidMinor: 0,
      sure: true,
    });
    expect(await pulled(friend, 'money.iou', id)).toBeUndefined();
    // a payment can't point at someone else's debt
    const tx = v7();
    const bad = await push(friend, 'money.transaction', tx, {
      amountMinor: 100,
      direction: 'credit',
      occurredAt: new Date().toISOString(),
      iouId: id,
    });
    expect(JSON.stringify(bad.body)).toMatch(/reject|invalid|not/i);
    expect(await pulled(friend, 'money.transaction', tx)).toBeUndefined();
  });
});

describe('money in waits for a yes (spec 0014)', () => {
  it('a captured credit is not counted until I say; “Don’t count it” keeps it out', async () => {
    const id = await credit('Some Sender', 120000);
    expect((await pulled(me, 'money.transaction', id)).data.counted).toBe(false);
    const n = (await asks()).find((x) => x.title === '₹1,200 came in from Some Sender');
    expect(n.actions.map((a: any) => a.id)).toEqual(expect.arrayContaining(['nocount', 'reply', 'transfer']));
    await act(n, 'nocount');
    expect((await pulled(me, 'money.transaction', id)).data).toMatchObject({
      counted: false,
      reviewed: true,
    });
  });

  it('money from someone who owes me is offered as paying back; a yes settles the debt and is not income', async () => {
    const debt = v7();
    await push(me, 'money.iou', debt, {
      person: 'Asha Rao',
      direction: 'owed_to_me',
      amountMinor: 200000,
      startedAt: new Date().toISOString(),
    });
    const id = await credit('Asha', 200000);
    const n = (await asks()).find((x) => x.title === '₹2,000 came in from Asha');
    expect(n.actions[0]).toEqual({ id: `repay.${debt}`, label: 'Asha Rao paying back' });
    expect(n.body).toContain('They owe you ₹2,000');
    await act(n, `repay.${debt}`);
    expect((await pulled(me, 'money.transaction', id)).data).toMatchObject({
      counted: false,
      reviewed: true,
      iouId: debt,
    });
    expect((await pulled(me, 'money.iou', debt)).data).toMatchObject({
      paidMinor: 200000,
      settledAt: expect.any(String),
    });
  });

  it('filing a credit under a category counts it as income', async () => {
    const id = await credit('Employer Pvt Ltd', 9000000);
    const n = (await asks()).find((x) => x.title === '₹90,000 came in from Employer Pvt Ltd');
    const cat = n.actions.find((a: any) => a.id.startsWith('c.'));
    await act(n, cat.id);
    expect((await pulled(me, 'money.transaction', id)).data).toMatchObject({ counted: true, reviewed: true });
  });

  it('typed money in counts at once — I said it myself', async () => {
    const id = v7();
    await push(me, 'money.transaction', id, {
      amountMinor: 5000,
      direction: 'credit',
      occurredAt: new Date().toISOString(),
      merchant: 'Refund',
      source: 'manual',
    });
    expect((await pulled(me, 'money.transaction', id)).data.counted).toBe(true);
  });
});
