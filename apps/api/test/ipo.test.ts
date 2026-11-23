import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IpoService } from '../src/modules/ipo/ipo.service';
import { PoolService } from '../src/modules/ipo/pool.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

/** "Now" is 11:00 in Kolkata today. */
const real = new Date();
const ist = new Date(real.getTime() + 330 * 60_000);
const TODAY = ist.toISOString().slice(0, 10);
const NOW = Date.parse(`${TODAY}T05:30:00Z`);
const day = (n: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ a fake IPO Guru
const big = {
  slug: 'mega-power-ipo',
  name: 'Mega Power',
  display_name: 'Mega Power Ltd',
  type: 'Mainboard',
  status: 'Open',
  open_date: TODAY,
  close_date: day(2),
  allotment_date: day(3),
  listing_date: day(5),
  price_band: '140-148',
  price_min: 140,
  price_max: 148,
  issue_size: 1000,
  lot_size: 101,
  min_investment: 14948,
  logo: 'https://www.ipoguru.in/storage/logos/mega-power.webp',
  gmp: { price: '40', updated_at: `${TODAY}T04:00:00Z`, subject_to_sauda: '1400,,19600' },
  subscription_total: 3.1,
  web_url: 'https://www.ipoguru.in/ipo/mega-power',
};
const small = {
  ...big,
  slug: 'tiny-foods-ipo',
  name: 'Tiny Foods',
  display_name: 'Tiny Foods Ltd',
  issue_size: 60,
  gmp: { price: '5', updated_at: `${TODAY}T04:00:00Z` },
};
// an SME IPO: off the desk until SME is switched on (spec 0016 A1)
const sme = {
  ...big,
  slug: 'kiddo-toys-sme-ipo',
  name: 'Kiddo Toys',
  display_name: 'Kiddo Toys',
  type: 'SME',
  issue_size: 40,
  lot_size: 1200,
  price_band: null,
  price_min: null,
  price_max: null,
  issue_price: '95',
  gmp: { price: '12', updated_at: `${TODAY}T04:00:00Z` },
};
let feedCalls: string[] = [];
const retail = 12.5;
let server: Server;
let feedUrl = '';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let ipo: IpoService;
let pool: PoolService;
const api = <T = any>(who: SessionResponse, method: string, path: string, body?: unknown) =>
  call<T>(h, method, path, { token: who.accessToken, body });
const notes = async (kind?: string) =>
  ((await api(me, 'GET', '/notifications')).body.items as any[]).filter(
    (n) => n.module === 'ipo' && (!kind || n.kind === kind),
  );

beforeAll(async () => {
  server = createServer((req, res) => {
    feedCalls.push(req.url!);
    const send = (b: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (req.headers['x-api-key'] !== 'test-key') {
      res.writeHead(401);
      return res.end();
    }
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/ipos') return send({ data: [big, small, sme] });
    const m = /^\/ipos\/([\w-]+)$/.exec(u.pathname);
    if (m) {
      const base = m[1] === big.slug ? big : m[1] === sme.slug ? sme : small;
      return send({
        data: {
          ...base,
          timeline: { open_date: base.open_date, close_date: base.close_date, refund_date: day(4) },
          subscription_summary: {
            total: 3.1,
            qib: 1.2,
            nii: 4.4,
            retail,
            applications: 1_000_000,
            updated_at: `${TODAY}T05:00:00Z`,
          },
        },
      });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h = await startApp([], {
    IPO_FEED: 'ipoguru',
    IPO_FEED_URL: feedUrl,
    IPO_FEED_KEY: 'test-key',
    IPO_FEED_DAILY_CALLS: '4',
    IPO_FEED_PER_MIN: '100',
  });
  ipo = h.app.get(IpoService);
  pool = h.app.get(PoolService);
  ipo.now = () => NOW;
  pool.now = () => NOW;
  me = (await signIn(h, OWNER)).body;
  const inv = await api(me, 'POST', '/admin/invites', {
    email: 'friend@example.test',
    entitlements: ['ipo'],
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(async () => {
  await h.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('the IPO desk (spec 0010 A)', () => {
  it('refreshes from the feed within the plan’s daily calls (AC1; spec 0016 AC2)', async () => {
    expect(await ipo.refresh()).toBe(6); // three new IPOs from one calendar call, then each one's details
    // the calendar + 3 details = 4 calls, the day's whole budget; mainboard details first
    expect(feedCalls.map((c) => c.split('?')[0])).toEqual([
      '/ipos',
      expect.stringMatching(/mega-power|tiny-foods/),
      expect.stringMatching(/mega-power|tiny-foods/),
      `/ipos/${sme.slug}`,
    ]);
    expect(feedCalls[0]).toBe('/ipos?months=2&limit=100');
    feedCalls = [];
    expect(await ipo.refresh()).toBe(0);
    expect(feedCalls).toEqual([]); // nothing left today, and the calendar is not due for 3 hours
  });

  it('shows GMP, subscription, odds and a verdict; the source is credited', async () => {
    const r = await api(me, 'GET', '/ipo/issues');
    expect(r.body.feed).toMatchObject({ name: 'IPO Guru', ready: true, credit: 'https://www.ipoguru.in' });
    const m = r.body.issues.find((i: any) => i.slug === big.slug);
    expect(m).toMatchObject({
      name: 'Mega Power Ltd',
      status: 'open',
      priceMax: 148,
      lotSize: 101,
      gmp: 40,
      estListingPrice: 188,
      refundDate: day(4),
      sourceUrl: 'https://www.ipoguru.in',
      // spec 0016: the four card figures and the rest of the calendar's facts
      issueSizeCr: 1000,
      minInvestment: 14948,
      gainPerLot: 4040,
      logo: 'https://www.ipoguru.in/storage/logos/mega-power.webp',
      sauda: 1400,
      decision: null,
    });
    // mainboard only, unless asked (spec 0016 AC1)
    expect(r.body.show).toBe('mainboard');
    expect(r.body.issues.some((i: any) => i.slug === sme.slug)).toBe(false);
    const all = (await api(me, 'GET', '/ipo/issues?type=all')).body.issues;
    expect(all.find((i: any) => i.slug === sme.slug)).toMatchObject({ type: 'sme', priceMax: 95 });
    expect(m.gmpPct).toBeCloseTo(27.03, 1);
    expect(m.subscription).toMatchObject({ retail: 12.5, qib: 1.2 });
    const odds = m.odds.find((o: any) => o.category === 'retail');
    expect(odds).toMatchObject({ minLots: 1, minAmount: 14948, basis: 'estimate', lotsOnOffer: 234_145 });
    expect(odds.chance).toBeCloseTo(0.08, 6);
    expect(m.verdict).toBe('GMP 27% · retail odds ~8%.');
  });

  it('figures typed by hand stay through refreshes and leave a history', async () => {
    const m = (await api(me, 'GET', '/ipo/issues')).body.issues.find((i: any) => i.slug === big.slug);
    await api(me, 'PUT', `/ipo/issues/${m.id}/figures`, {
      gmp: 52,
      subscription: { retail: 20, retailApplications: 2_341_450 },
    });
    await ipo.upsert({ ...(await import('../src/modules/ipo/feed')).IpoGuruFeed.issue(big as any) });
    const d = (await api(me, 'GET', `/ipo/issues/${m.id}`)).body;
    expect(d.gmp).toBe(52);
    expect(d.manual.sort()).toEqual(['gmp', 'subscription']);
    expect(d.odds[0]).toMatchObject({ basis: 'exact' });
    expect(d.odds[0].chance).toBeCloseTo(0.1, 6);
    expect(d.history.map((x: any) => [x.gmp, x.retail])).toEqual([
      [40, null],
      [40, 12.5],
      [52, 20],
    ]);
    await api(me, 'DELETE', `/ipo/issues/${m.id}/figures`);
  });

  it('notifies only what the settings let through, each once (AC3)', async () => {
    await api(me, 'PUT', '/ipo/settings', { minIssueSizeCr: 1000, types: ['mainboard'] });
    expect(await ipo.alert(me.user.id)).toBe(2); // the first GMP reading only sets the baseline
    const titles = (await notes('ipo')).map((n) => n.title).sort();
    expect(titles).toEqual(['Mega Power Ltd opens today', 'Mega Power Ltd: retail over 10×']);
    expect(titles.some((t) => t.includes('Tiny Foods'))).toBe(false); // ₹60 cr is below the ₹1,000 cr line
    expect(await ipo.alert(me.user.id)).toBe(0);
  });

  it('a starred IPO always passes; GMP moves ping past the threshold', async () => {
    const tiny = (await api(me, 'GET', '/ipo/issues')).body.issues.find((i: any) => i.slug === small.slug);
    await api(me, 'PUT', `/ipo/issues/${tiny.id}/star`, { on: true });
    await ipo.alert(me.user.id);
    expect((await notes('ipo')).some((n) => n.title === 'Tiny Foods Ltd opens today')).toBe(true);
    await api(me, 'PUT', `/ipo/issues/${tiny.id}/figures`, { gmp: 20 }); // 3% → 14%
    await ipo.alert(me.user.id);
    expect((await notes('ipo')).some((n) => n.title === 'Tiny Foods Ltd: GMP up to 14%')).toBe(true);
  });
});

describe('will you apply? (spec 0016 A5, AC3)', () => {
  const at = (d: string, hhmmIst: string) => {
    const [hh, mm] = hhmmIst.split(':').map(Number) as [number, number];
    return Date.parse(`${d}T00:00:00Z`) + (hh * 60 + mm - 330) * 60_000;
  };
  const taskRows = async () => {
    const latest = new Map<string, any>();
    for (const c of (await api(me, 'GET', '/sync/pull?cursor=0')).body.changes as any[])
      if (c.entity === 'today.task') latest.set(c.entityId, c);
    return [...latest.values()];
  };
  let mega: any;

  it('the desk remembers SME being switched on, on every device', async () => {
    const s = (await api(me, 'GET', '/ipo/settings')).body;
    expect(s).toMatchObject({ showSme: false, applyBy: '14:00' });
    expect(s.events).toContain('decide');
    await api(me, 'PUT', '/ipo/settings', { ...s, showSme: true });
    expect((await api(me, 'GET', '/ipo/issues')).body.show).toBe('all');
    await api(me, 'PUT', '/ipo/settings', { ...s, showSme: false });
  });

  it('“opens today” asks; I’ll apply makes one task, due on the close day at 2 pm, reminded that morning', async () => {
    const n = (await notes('ipo')).find((x) => x.title === 'Mega Power Ltd opens today');
    expect(n.actions.map((a: any) => a.id)).toEqual(['apply', 'skip']);
    expect(n.body).toContain('1 lot ₹14,948');
    expect((await api(me, 'POST', `/notifications/${n.id}/actions/apply`, {})).status).toBe(200);
    mega = (await api(me, 'GET', '/ipo/issues')).body.issues.find((i: any) => i.slug === big.slug);
    expect(mega.decision).toBe('applying');
    const t = (await taskRows()).find((c) => c.entityId === mega.taskId);
    expect(t.data).toMatchObject({
      title: 'Apply for Mega Power Ltd IPO',
      dueAt: new Date(at(day(2), '14:00')).toISOString(),
      tags: ['ipo'],
      priority: 3,
      reminders: [
        { kind: 'at', at: new Date(at(day(2), '09:30')).toISOString() },
        { kind: 'before', minutes: 30 },
      ],
    });
    // saying it again doesn't make a second task
    await api(me, 'PUT', `/ipo/issues/${mega.id}/decision`, { decision: 'applying' });
    expect((await taskRows()).filter((c) => c.data?.title === 'Apply for Mega Power Ltd IPO')).toHaveLength(
      1,
    );
  });

  it('the last day asks “applied?”; Applied ticks the task', async () => {
    ipo.now = () => at(day(2), '10:05');
    await ipo.alert(me.user.id);
    const n = (await notes('ipo')).find((x) => x.title === 'Last day for Mega Power Ltd — applied?');
    expect(n).toMatchObject({ priority: 'high' });
    expect(n.actions.map((a: any) => a.id)).toEqual(['applied', 'skip']);
    await api(me, 'POST', `/notifications/${n.id}/actions/applied`, {});
    const t = (await taskRows()).find((c) => c.entityId === mega.taskId);
    expect(t.data.completedAt).toEqual(expect.any(String));
  });

  it('allotment evening asks “did you get it?”; listing morning says what the lot may make', async () => {
    ipo.now = () => at(day(3), '18:10');
    await ipo.alert(me.user.id);
    const n = (await notes('ipo')).find(
      (x) => x.title === 'Mega Power Ltd: allotment is out — did you get it?',
    );
    expect(n.actions.map((a: any) => a.id)).toEqual(['allotted', 'missed']);
    await api(me, 'POST', `/notifications/${n.id}/actions/allotted`, {});
    ipo.now = () => at(day(5), '09:20');
    await ipo.alert(me.user.id);
    const l = (await notes('ipo')).find((x) => x.title === 'Mega Power Ltd lists today at 10 am');
    expect(l.body).toContain('+₹5,252 on your lot'); // GMP ₹52 (typed in earlier) × 101 shares
    expect((await api(me, 'GET', `/ipo/issues/${mega.id}`)).body.decision).toBe('allotted');
    ipo.now = () => NOW;
  });

  it('Skip removes the task; someone else can’t decide for me', async () => {
    const tiny = (await api(me, 'GET', '/ipo/issues')).body.issues.find((i: any) => i.slug === small.slug);
    const r = await api(me, 'PUT', `/ipo/issues/${tiny.id}/decision`, { decision: 'applying' });
    await api(me, 'PUT', `/ipo/issues/${tiny.id}/decision`, { decision: 'skipped' });
    const t = (await taskRows()).find((c) => c.entityId === r.body.taskId);
    expect(t.op === 'delete' || t.deleted === true || t.data === null).toBe(true);
    // the friend's own decision is theirs alone
    await api(friend, 'PUT', `/ipo/issues/${tiny.id}/decision`, { decision: 'applying' });
    expect((await api(me, 'GET', `/ipo/issues/${tiny.id}`)).body.decision).toBe('skipped');
  });
});

describe('the IPO Pool (spec 0010 B)', () => {
  let ravi: string, priya: string, amit: string;
  let meSrc: string, brother: string, card: string;
  let mega: any;
  let roundId: string;

  it('partners and sources; your own money is there from the start', async () => {
    const s = (await api(me, 'GET', '/ipo/pool/sources')).body;
    expect(s.map((x: any) => x.name)).toEqual(['Me']);
    meSrc = s[0].id;
    brother = (await api(me, 'POST', '/ipo/pool/sources', { name: 'Brother', kind: 'family', repay: true }))
      .body.id;
    card = (await api(me, 'POST', '/ipo/pool/sources', { name: 'HDFC card cash', kind: 'card', feePct: 2.5 }))
      .body.id;
    ravi = (
      await api(me, 'POST', '/ipo/pool/partners', { name: 'Ravi', share: { kind: 'percent', value: 25 } })
    ).body.id;
    priya = (
      await api(me, 'POST', '/ipo/pool/partners', { name: 'Priya', share: { kind: 'fixed', value: 500 } })
    ).body.id;
    amit = (await api(me, 'POST', '/ipo/pool/partners', { name: 'Amit', relation: 'cousin' })).body.id;
    expect((await api(me, 'GET', '/ipo/pool/partners')).body).toHaveLength(3);
  });

  it('money sent earlier stays as float; a card transfer records its fee (AC4, AC5)', async () => {
    // Ravi still holds ₹15,000 from an earlier IPO; Priya got ₹10,000 from Brother
    await api(me, 'POST', '/ipo/pool/ledger', {
      kind: 'fund',
      amount: 15000,
      sourceId: meSrc,
      partnerId: ravi,
    });
    await api(me, 'POST', '/ipo/pool/ledger', {
      kind: 'fund',
      amount: 10000,
      sourceId: brother,
      partnerId: priya,
    });
    mega = (await api(me, 'GET', '/ipo/issues')).body.issues.find((i: any) => i.slug === big.slug);
    expect(mega.pool).toMatchObject({ accounts: 3 });
    expect(mega.pool.cardCost).toBe(0); // the cheapest source is your own money

    const r = await api(me, 'POST', '/ipo/pool/rounds', {
      issueId: mega.id,
      partnerIds: [ravi, priya, amit],
    });
    roundId = r.body.id;
    const byName = (n: string) => r.body.applications.find((a: any) => a.partner.name === n);
    expect(byName('Ravi')).toMatchObject({ amountMinor: 1_494_800, holdsMinor: 1_500_000, needMinor: 0 });
    expect(byName('Priya')).toMatchObject({ holdsMinor: 1_000_000, needMinor: 494_800 });
    expect(byName('Amit')).toMatchObject({ holdsMinor: 0, needMinor: 1_494_800 });
    expect(r.body.toSendMinor).toBe(494_800 + 1_494_800);

    // Priya's top-up from you; Amit's from the card (2.5% = ₹373.70)
    await api(me, 'POST', '/ipo/pool/ledger', {
      kind: 'fund',
      amount: 4948,
      sourceId: meSrc,
      partnerId: priya,
      roundId,
    });
    const f = await api(me, 'POST', '/ipo/pool/ledger', {
      kind: 'fund',
      amount: 14948,
      sourceId: card,
      partnerId: amit,
      roundId,
    });
    expect(f.body.map((e: any) => [e.kind, e.amountMinor])).toEqual([
      ['fund', 1_494_800],
      ['cost', 37_370],
    ]);
    const after = (await api(me, 'GET', `/ipo/pool/rounds/${roundId}`)).body;
    expect(after.applications.every((a: any) => a.needMinor === 0)).toBe(true);
    expect(after.costsMinor).toBe(37_370);
  });

  it('partners confirm by their private link, and only see their own (AC6)', async () => {
    const link = (await api(me, 'POST', `/ipo/pool/partners/${ravi}/link`)).body;
    const token = link.url.split('/p/')[1];
    const page = (await call<any>(h, 'GET', `/pool-links/${token}`)).body;
    expect(page).toMatchObject({ partner: 'Ravi', holds: 15000, shareRule: { kind: 'percent', value: 25 } });
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toMatch(/Priya|Amit|Brother/);
    const appId = page.items[0].id;

    const priyaApp = (await api(me, 'GET', `/ipo/pool/rounds/${roundId}`)).body.applications.find(
      (a: any) => a.partner.name === 'Priya',
    );
    expect(
      (
        await call(h, 'POST', `/pool-links/${token}/applications/${priyaApp.id}`, {
          body: { action: 'applied' },
        })
      ).status,
    ).toBe(404);

    await call(h, 'POST', `/pool-links/${token}/applications/${appId}`, { body: { action: 'applied' } });
    expect((await notes('pool')).map((n) => n.title)).toContain('Ravi applied');
    const round = (await api(me, 'GET', `/ipo/pool/rounds/${roundId}`)).body;
    expect(round.applications.find((a: any) => a.partner.name === 'Ravi')).toMatchObject({
      status: 'applied',
      reportedBy: 'partner',
    });

    await api(me, 'DELETE', `/ipo/pool/partners/${ravi}/link`);
    expect((await call(h, 'GET', `/pool-links/${token}`)).status).toBe(404);
    expect((await call(h, 'GET', `/pool-links/not-a-real-token-at-all-xyz`)).status).toBe(404);
  });

  it('closing day: a nudge for accounts that haven’t applied', async () => {
    const at = ipo.now;
    ipo.now = () => Date.parse(`${day(2)}T05:30:00Z`);
    await ipo.alert(me.user.id);
    ipo.now = at;
    expect((await notes('pool')).map((n) => n.title)).toContain(
      '2 accounts haven’t applied — Mega Power Ltd closes today',
    );
  });

  it('allotment, sale, shares by rule, settlement — and where the profit went (AC5)', async () => {
    const apps = (await api(me, 'GET', `/ipo/pool/rounds/${roundId}`)).body.applications;
    const app = (n: string) => apps.find((a: any) => a.partner.name === n);
    await api(me, 'PUT', `/ipo/pool/applications/${app('Priya').id}`, { status: 'applied' });
    await api(me, 'PUT', `/ipo/pool/applications/${app('Amit').id}`, { status: 'applied' });
    // Ravi and Priya get a lot; Amit doesn't (his ₹14,948 stays with him as float)
    await api(me, 'PUT', `/ipo/pool/applications/${app('Ravi').id}`, { allottedLots: 1 });
    await api(me, 'PUT', `/ipo/pool/applications/${app('Priya').id}`, { allottedLots: 1 });
    await api(me, 'PUT', `/ipo/pool/applications/${app('Amit').id}`, { status: 'not_allotted' });
    // sold at ₹180: 101 × ₹32 = ₹3,232 gain, less ₹20 charges = ₹3,212
    await api(me, 'PUT', `/ipo/pool/applications/${app('Ravi').id}`, { soldPrice: 180, saleCosts: 20 });
    await api(me, 'PUT', `/ipo/pool/applications/${app('Priya').id}`, { soldPrice: 180, saleCosts: 20 });
    const sold = (await api(me, 'GET', `/ipo/pool/rounds/${roundId}`)).body.applications;
    const s = (n: string) => sold.find((a: any) => a.partner.name === n);
    expect(s('Ravi')).toMatchObject({
      gainMinor: 321_200,
      shareMinor: 80_300,
      backMinor: 1_494_800 + 321_200 - 80_300,
    });
    expect(s('Priya')).toMatchObject({ gainMinor: 321_200, shareMinor: 50_000 });

    // Ravi sends everything back; Priya keeps the principal as float, sends the profit only
    await api(me, 'POST', `/ipo/pool/applications/${s('Ravi').id}/settle`, {
      returned: (1_494_800 + 321_200 - 80_300) / 100,
    });
    await api(me, 'POST', `/ipo/pool/applications/${s('Priya').id}/settle`, {
      returned: (321_200 - 50_000) / 100,
    });
    // you pay Brother back ₹5,000 of his ₹10,000
    await api(me, 'POST', '/ipo/pool/ledger', { kind: 'repay', amount: 5000, sourceId: brother });

    const sum = (await api(me, 'GET', '/ipo/pool/summary')).body;
    expect(sum).toMatchObject({
      gainMinor: 642_400,
      costsMinor: 37_370,
      sharesMinor: 130_300,
      netMinor: 642_400 - 37_370 - 130_300,
      owedMinor: 500_000,
      inSharesMinor: 0,
      sharesDueMinor: 0,
    });
    const pos = (n: string) => sum.partners.find((p: any) => p.name === n);
    // Ravi: 15,000 in − 17,357 back + 3,212 gain − 803 share = 52 paise short of zero → exactly 0 after rounding
    expect(pos('Ravi').cash).toBe(1_500_000 - 1_735_700 + 321_200 - 80_300);
    expect(pos('Priya').cash).toBe(1_494_800); // her principal, ready for the next IPO
    expect(pos('Amit').cash).toBe(1_494_800);
    expect(sum.sources.find((x: any) => x.name === 'Brother')).toMatchObject({
      given: 1_000_000,
      back: 500_000,
      owed: 500_000,
    });
    expect(sum.sources.find((x: any) => x.name === 'HDFC card cash')).toMatchObject({ fees: 37_370 });
  });

  it('nobody else sees any of it; without the module the server refuses (AC7)', async () => {
    expect((await api(friend, 'GET', '/ipo/pool/partners')).body).toEqual([]);
    expect((await api(friend, 'GET', `/ipo/pool/rounds/${roundId}`)).status).toBe(404);
    expect(
      (
        await api(friend, 'POST', '/ipo/pool/ledger', {
          kind: 'fund',
          amount: 1,
          sourceId: meSrc,
          partnerId: ravi,
        })
      ).status,
    ).toBe(404);
    expect((await api(friend, 'POST', `/ipo/pool/partners/${ravi}/link`)).status).toBe(404);
    const inv = await api(me, 'POST', '/admin/invites', {
      email: 'noipo@example.test',
      entitlements: ['today'],
    });
    const other = (await signIn(h, 'noipo@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
    expect((await api(other, 'GET', '/ipo/issues')).status).toBe(403);
  });
});
