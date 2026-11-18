import { formatMoney, Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiService } from '../src/modules/ai/ai.service';
import { type FakeModel } from '../src/modules/ai/fake.model';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let fake: FakeModel;
const clock = new Hlc('dev');
let cats: Record<string, string> = {};

const push = (entity: string, id: string, fields: Record<string, unknown>, op = 'upsert') =>
  call<any>(h, 'POST', '/sync/push', {
    token: me.accessToken,
    body: { mutations: [{ mutationId: v7(), entity, entityId: id, op, fields, hlc: clock.tick() }] },
  });
const inbox = async () =>
  ((await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body.items as any[]).filter(
    (n) => n.module === 'money',
  );
const row = async (id: string) =>
  (
    (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: me.accessToken })).body.changes as any[]
  ).findLast((c) => c.entity === 'money.transaction' && c.entityId === id);
const act = (n: any, action: string, text?: string) =>
  call<any>(h, 'POST', `/notifications/${n.id}/actions/${action}`, {
    token: me.accessToken,
    body: text === undefined ? {} : { text },
  });

/** A payment the phone read from an SMS, a minute ago. */
const titles = new Map<string, string>();
async function captured(merchant: string, amountMinor = 24000, extra: Record<string, unknown> = {}) {
  const id = v7();
  titles.set(id, `${formatMoney(amountMinor)} at ${merchant}`);
  await push('money.transaction', id, {
    amountMinor,
    direction: 'debit',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    merchant,
    rawMerchant: merchant.toUpperCase(),
    source: 'sms',
    reviewed: false,
    ...extra,
  });
  return id;
}
const ask = async (id: string) =>
  (await inbox()).find((n) => n.kind === 'review' && n.title === titles.get(id) && !n.dismissedAt);

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  fake = h.app.get(AiService).model as FakeModel;
  me = (await signIn(h, OWNER)).body;
  await call(h, 'POST', '/money/setup', { token: me.accessToken });
  const pulled = (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: me.accessToken })).body
    .changes as any[];
  cats = Object.fromEntries(
    pulled.filter((c) => c.entity === 'money.category').map((c) => [c.data.slug, c.entityId]),
  );
});
afterAll(() => h.close());

describe('smart review of captured payments (spec 0007 C1)', () => {
  it('asks what it was: the likely category, a reply box, not mine; typed entries are never asked about', async () => {
    const id = await captured('Swiggy');
    const n = await ask(id);
    expect(n.title).toBe('₹240 at Swiggy');
    expect(n.actions[0]).toEqual({ id: `c.${cats.food}`, label: 'Food & dining' });
    expect(n.actions[1]).toMatchObject({
      id: 'reply',
      label: 'Reply',
      reply: { placeholder: expect.any(String) },
    });
    expect(n.actions[2]).toEqual({ id: 'ignore', label: 'Not mine' });

    const typed = v7();
    await push('money.transaction', typed, {
      amountMinor: 5000,
      direction: 'debit',
      occurredAt: new Date().toISOString(),
      merchant: 'Chai',
      source: 'manual',
      reviewed: false,
    });
    expect(await ask(typed)).toBeUndefined();

    // tapping the category files it, everywhere, and clears the question
    expect((await act(n, `c.${cats.food}`)).status).toBe(200);
    expect((await row(id)).data).toMatchObject({ categoryId: cats.food, reviewed: true });
    expect(await ask(id)).toBeUndefined();
  });

  it('a reply is read without AI: a category, a split with my share, a note', async () => {
    const id = await captured('Barbeque Nation', 300000);
    const n = await ask(id);
    expect((await act(n, 'reply')).status).toBe(400); // the reply box needs words
    const calls = fake.calls.length;
    await act(n, 'reply', 'split 3 food - team dinner');
    expect((await row(id)).data).toMatchObject({
      categoryId: cats.food,
      reviewed: true,
      amountMinor: 100000,
      note: 'Split 3 ways of ₹3,000 · team dinner',
    });
    expect(fake.calls.length).toBe(calls);
  });

  it('“not mine” removes it; “always …” files the next one silently with a note to change it', async () => {
    const a = await captured('Random Shop');
    await act(await ask(a), 'ignore');
    expect((await row(a)).op).toBe('delete');

    const b = await captured('Indian Oil', 150000);
    await act(await ask(b), 'reply', 'always fuel');
    expect((await row(b)).data.categoryId).toBe(cats.fuel);

    const c = await captured('INDIAN OIL', 90000);
    expect(await ask(c)).toBeUndefined();
    expect((await row(c)).data).toMatchObject({ categoryId: cats.fuel, reviewed: true });
    const note = (await inbox()).find((x) => x.kind === 'filed' && x.title === 'Filed ₹900 at INDIAN OIL');
    expect(note).toMatchObject({
      title: 'Filed ₹900 at INDIAN OIL',
      body: 'As Fuel, like before.',
      priority: 'low',
    });
    // "Change" puts it back under New
    await act(note, 'change');
    expect((await row(c)).data.reviewed).toBe(false);
  });

  it('the same answer twice is learned; the rules can be seen and removed', async () => {
    for (const amt of [20000, 30000]) {
      const id = await captured('Blinkit', amt);
      await act(await ask(id), `c.${cats.groceries}`);
    }
    const third = await captured('Blinkit', 40000);
    expect(await ask(third)).toBeUndefined();
    expect((await row(third)).data.categoryId).toBe(cats.groceries);

    const rules = (await call<any>(h, 'GET', '/money/rules', { token: me.accessToken })).body as any[];
    const blinkit = rules.find((r) => r.merchant === 'Blinkit');
    expect(blinkit).toMatchObject({ action: 'category', category: 'Groceries', hits: 2, active: true });
    expect((await call(h, 'DELETE', `/money/rules/${blinkit.id}`, { token: me.accessToken })).status).toBe(
      204,
    );
    const again = await captured('Blinkit', 50000);
    expect(await ask(again)).toBeDefined();
  });

  it('a reply the rules can’t read goes to the cheapest AI, limited to my categories; nonsense asks again', async () => {
    const id = await captured('Zorba', 64000);
    // the model sees only the reply as data; the numbered list is in its instructions (Entertainment is 9th)
    fake.handlers['money.reply'] = (text) => (/bowling/.test(text) ? { pick: 9 } : { pick: 0 });
    await act(await ask(id), 'reply', 'bowling night');
    expect(fake.calls.at(-1)!.task).toBe('money.reply');
    expect((await row(id)).data).toMatchObject({ categoryId: cats.entertainment, reviewed: true });

    const other = await captured('Qwerty', 1000);
    await act(await ask(other), 'reply', 'zzz');
    const again = await ask(other);
    expect(again.body).toMatch(/^Didn’t catch “zzz”/);
    delete fake.handlers['money.reply'];
  });

  it('reviewed in the app: the question disappears from every device', async () => {
    const id = await captured('Uber', 18000);
    expect(await ask(id)).toBeDefined();
    await push('money.transaction', id, { reviewed: true, categoryId: cats.transport });
    expect(await ask(id)).toBeUndefined();
  });
});
