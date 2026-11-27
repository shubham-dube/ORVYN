import type { SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let asha: SessionResponse;
let ravi: SessionResponse;
let outsider: SessionResponse;
let noSplit: SessionResponse;
const api = <T = any>(who: SessionResponse, method: string, path: string, body?: unknown) =>
  call<T>(h, method, path, { token: who.accessToken, body });
async function invite(email: string, entitlements: string[]) {
  const inv = await api(asha, 'POST', '/admin/invites', { email, entitlements });
  return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body;
}

beforeAll(async () => {
  h = await startApp();
  asha = (await signIn(h, OWNER)).body;
  ravi = await invite('ravi@example.test', ['split', 'chat']);
  outsider = await invite('out@example.test', ['split']);
  noSplit = await invite('nos@example.test', ['today']);
});
afterAll(() => h.close());

describe('Split (spec 0011 B)', () => {
  let g: any;
  const m = (name: string) => g.members.find((x: any) => x.name === name).id;

  it('a trip with an ORVYN friend and two guests, with its own group chat', async () => {
    const r = await api(asha, 'POST', '/split/groups', {
      name: 'Goa',
      kind: 'trip',
      memberIds: [ravi.user.id],
      guests: [
        { name: 'Mia', phone: '98765 43210' },
        { name: 'Dev', phone: '' },
      ],
      withChat: true,
    });
    expect(r.status).toBe(201);
    g = r.body;
    expect(g.members.map((x: any) => [x.name, x.guest])).toEqual([
      ['owner', false],
      ['ravi', false],
      ['Mia', true],
      ['Dev', true],
    ]);
    expect(g.conversationId).toBeTruthy();
    expect(
      (await api(ravi, 'GET', '/notifications')).body.items.some(
        (n: any) => n.title === 'owner added you to “Goa”',
      ),
    ).toBe(true);
  });

  it('contributions must add up; splits must make sense', async () => {
    const base = { title: 'Hotel', amount: 8000, date: '2026-11-20', category: 'stay' };
    const bad1 = await api(asha, 'POST', `/split/groups/${g.id}/expenses`, {
      ...base,
      paid: [{ memberId: m('owner'), amount: 5000 }],
      split: { method: 'equal', among: [{ memberId: m('owner') }] },
    });
    expect(bad1.body.error).toMatchObject({ code: 'paid_mismatch' });
    const bad2 = await api(asha, 'POST', `/split/groups/${g.id}/expenses`, {
      ...base,
      paid: [{ memberId: m('owner'), amount: 8000 }],
      split: {
        method: 'percent',
        among: [
          { memberId: m('owner'), value: 50 },
          { memberId: m('ravi'), value: 30 },
        ],
      },
    });
    expect(bad2.body.error).toMatchObject({
      code: 'bad_split',
      message: 'percentages add up to 80, not 100',
    });
  });

  it('several payers, different splits, a payment back — balances and the fewest transfers (AC4)', async () => {
    // hotel ₹8,000: owner paid 5,000 and Ravi 3,000; equal among four
    await api(asha, 'POST', `/split/groups/${g.id}/expenses`, {
      title: 'Hotel',
      amount: 8000,
      date: '2026-11-20',
      category: 'stay',
      paid: [
        { memberId: m('owner'), amount: 5000 },
        { memberId: m('ravi'), amount: 3000 },
      ],
      split: { method: 'equal', among: ['owner', 'ravi', 'Mia', 'Dev'].map((n) => ({ memberId: m(n) })) },
    });
    // dinner ₹2,400 paid by Mia (a guest), shared 2:1:1 by Mia, Dev and owner — Ravi added it
    const d = await api(ravi, 'POST', `/split/groups/${g.id}/expenses`, {
      title: 'Dinner',
      amount: 2400,
      date: '2026-11-20',
      category: 'food',
      paid: [{ memberId: m('Mia'), amount: 2400 }],
      split: {
        method: 'shares',
        among: [
          { memberId: m('Mia'), value: 2 },
          { memberId: m('Dev'), value: 1 },
          { memberId: m('owner'), value: 1 },
        ],
      },
    });
    expect(d.status).toBe(201);
    // Dev pays the owner ₹1,000
    const s = await api(asha, 'POST', `/split/groups/${g.id}/settlements`, {
      fromId: m('Dev'),
      toId: m('owner'),
      amount: 1000,
      date: '2026-11-21',
    });
    g = s.body;
    const bal = Object.fromEntries(g.members.map((x: any) => [x.name, x.balance]));
    expect(bal).toEqual({ owner: 140_000, ravi: 100_000, Mia: -80_000, Dev: -160_000 });
    expect(g.plan.map((t: any) => [t.fromName, t.toName, t.amount])).toEqual([
      ['Dev', 'owner', 140_000],
      ['Mia', 'ravi', 80_000],
      ['Dev', 'ravi', 20_000],
    ]);
    expect(g.totalMinor).toBe(1_040_000);
    expect(g.byCategory).toEqual([
      { category: 'stay', amount: 800_000 },
      { category: 'food', amount: 240_000 },
    ]);
    // the owner was told their share of Ravi's dinner; the group chat got a plain line
    const n = (await api(asha, 'GET', '/notifications')).body.items.find((x: any) => x.kind === 'expense');
    expect(n).toMatchObject({ title: 'ravi added Dinner · ₹2,400', body: 'Goa · your share ₹600' });
    const lines = (await api(ravi, 'GET', `/chat/conversations/${g.conversationId}/messages`)).body as any[];
    expect(lines.filter((l) => l.kind === 'system').map((l) => l.text)).toContain(
      'Split · ravi added “Dinner” ₹2,400 (paid by Mia)',
    );
  });

  it('only who added an expense (or the admin) changes it; nobody outside sees anything (AC5)', async () => {
    const hotel = g.expenses.find((e: any) => e.title === 'Hotel');
    expect((await api(ravi, 'DELETE', `/split/groups/${g.id}/expenses/${hotel.id}`)).status).toBe(403);
    expect((await api(outsider, 'GET', `/split/groups/${g.id}`)).status).toBe(404);
    expect((await api(outsider, 'GET', '/split/groups')).body).toEqual({
      items: [],
      next: null,
      getMinor: 0,
      oweMinor: 0,
    });
    expect((await api(noSplit, 'GET', '/split/groups')).status).toBe(403);
    expect((await api(asha, 'DELETE', `/split/groups/${g.id}/members/${m('Dev')}`)).body.error).toMatchObject(
      {
        code: 'not_settled',
      },
    );
  });

  it('reminders: a notification for ORVYN people, a WhatsApp message with a private link for guests (AC6)', async () => {
    expect(
      (await api(asha, 'POST', `/split/groups/${g.id}/members/${m('ravi')}/remind`)).body.error,
    ).toMatchObject({
      code: 'owes_nothing',
    });
    const r = await api(asha, 'POST', `/split/groups/${g.id}/members/${m('Mia')}/remind`);
    expect(r.body.sent).toBe(false);
    expect(r.body.whatsapp).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(r.body.text).toMatch(/you owe ₹800: ₹800 to ravi\. Details: http.*\/s\//);
  });

  it('a guest’s link shows their own line, read-only, until it is turned off', async () => {
    const link = (await api(asha, 'POST', `/split/groups/${g.id}/members/${m('Dev')}/link`)).body;
    const token = link.url.split('/s/')[1];
    const page = (await call<any>(h, 'GET', `/split-links/${token}`)).body;
    expect(page).toMatchObject({ group: 'Goa', you: { name: 'Dev', balance: -160_000 } });
    expect(page.yourPlan.map((t: any) => [t.toName, t.amount])).toEqual([
      ['owner', 140_000],
      ['ravi', 20_000],
    ]);
    expect(page.expenses.find((e: any) => e.title === 'Dinner')).toMatchObject({
      paidBy: 'Mia',
      yourShare: 60_000,
    });
    await api(asha, 'DELETE', `/split/groups/${g.id}/members/${m('Dev')}/link`);
    expect((await call(h, 'GET', `/split-links/${token}`)).status).toBe(404);
  });

  it('a text summary for any chat; the list shows my balance', async () => {
    const t = (await api(asha, 'GET', `/split/groups/${g.id}/summary`)).body.text;
    expect(t).toContain('Goa — total ₹10,400');
    expect(t).toContain('• Dev → owner: ₹1,400');
    const mine = (await api(ravi, 'GET', '/split/groups')).body;
    expect(mine).toMatchObject({
      items: [{ name: 'Goa', myBalance: 100_000, members: 4, admin: false }],
      next: null,
      getMinor: 100_000,
      oweMinor: 0,
    });
    // the totals are the sums of each group's balance
    const all = (await api(asha, 'GET', '/split/groups')).body;
    const sum = (sign: number) =>
      all.items
        .filter((x: any) => x.myBalance * sign > 0)
        .reduce((t: number, x: any) => t + Math.abs(x.myBalance), 0);
    expect([all.getMinor, all.oweMinor]).toEqual([sum(1), sum(-1)]);
  });

  it('a page at a time, newest first, with every group once', async () => {
    for (const n of ['P1', 'P2', 'P3', 'P4', 'P5'])
      await api(outsider, 'POST', '/split/groups', { name: n, kind: 'party' });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const p = (await api(outsider, 'GET', `/split/groups${q}`)).body;
      expect(p.items.length).toBeLessThanOrEqual(2);
      seen.push(...p.items.map((x: any) => x.name));
      cursor = p.next;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(['P5', 'P4', 'P3', 'P2', 'P1']);
    expect(pages).toBe(3);
  });

  it('only who made a group deletes it, for everyone; it is gone from every list', async () => {
    expect((await api(ravi, 'DELETE', `/split/groups/${g.id}`)).status).toBe(403);
    expect((await api(outsider, 'DELETE', `/split/groups/${g.id}`)).status).toBe(404);
    expect((await api(asha, 'DELETE', `/split/groups/${g.id}`)).status).toBe(200);
    expect((await api(asha, 'GET', `/split/groups/${g.id}`)).status).toBe(404);
    const left = (await api(ravi, 'GET', '/split/groups')).body;
    expect(left.items.map((x: any) => x.id)).not.toContain(g.id);
    expect([left.getMinor, left.oweMinor]).toEqual([0, 0]);
  });
});
