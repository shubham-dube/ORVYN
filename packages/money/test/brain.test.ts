import { describe, expect, it } from 'vitest';
import {
  type BrainTx,
  historyCategory,
  merchantProfiles,
  merchantsForAmount,
  moneyInsights,
  suggestMerchants,
} from '../src/brain';

const TZ = 'Asia/Kolkata';
let n = 0;
const tx = (merchant: string, rupees: number, when: string, f: Partial<BrainTx> = {}): BrainTx => ({
  id: `t${++n}`,
  amountMinor: rupees * 100,
  direction: 'debit',
  occurredAt: new Date(`${when}+05:30`).toISOString(),
  merchant,
  categoryId: null,
  transfer: false,
  accountId: null,
  ...f,
});

const FOOD = 'cat-food';
const SUBS = 'cat-subs';
const history: BrainTx[] = [
  tx('Swiggy', 320, '2026-09-03T20:00:00', { categoryId: FOOD, accountId: 'hdfc' }),
  tx('Swiggy', 410, '2026-09-18T21:00:00', { categoryId: FOOD, accountId: 'hdfc' }),
  tx('SWIGGY', 280, '2026-10-02T13:00:00', { categoryId: FOOD, accountId: 'hdfc' }),
  tx('Swiggy', 350, '2026-10-20T20:30:00', { categoryId: FOOD, accountId: 'icici' }),
  tx('Swiggy', 390, '2026-11-05T20:30:00', { categoryId: FOOD, accountId: 'hdfc' }),
  tx('Netflix', 499, '2026-08-10T09:00:00', { categoryId: SUBS }),
  tx('Netflix', 499, '2026-09-10T09:00:00', { categoryId: SUBS }),
  tx('Netflix', 499, '2026-10-10T09:00:00', { categoryId: SUBS }),
  tx('Netflix', 649, '2026-11-10T09:00:00', { categoryId: SUBS }),
  tx('Chai Point', 45, '2026-11-02T08:00:00'),
  tx('Chai Point', 45, '2026-11-03T08:00:00'),
  tx('Chai Point', 45, '2026-11-04T08:00:00'),
  tx('Ramesh Kumar', 12000, '2026-11-01T10:00:00'),
];

describe('merchant profiles (spec 0013)', () => {
  const p = merchantProfiles(history);
  it('groups spellings, counts, finds the usual category, account and amounts', () => {
    const s = p.get('swiggy')!;
    expect(s).toMatchObject({
      count: 5,
      merchant: 'Swiggy',
      categoryId: FOOD,
      categoryShare: 1,
      accountId: 'hdfc',
    });
    expect(s.medianMinor).toBe(35_000);
    expect(p.get('chai point')!.amounts).toEqual([4_500]);
  });
  it('files without asking only when history is consistent (3+ times, 80%+)', () => {
    expect(historyCategory(p.get('swiggy'))).toEqual({ categoryId: FOOD, times: 5 });
    expect(historyCategory(p.get('chai point'))).toBeNull(); // never filed
    const mixed = merchantProfiles([
      ...history,
      tx('Amazon', 500, '2026-10-01T10:00:00', { categoryId: 'shop' }),
      tx('Amazon', 500, '2026-10-02T10:00:00', { categoryId: 'groc' }),
      tx('Amazon', 500, '2026-10-03T10:00:00', { categoryId: 'shop' }),
    ]);
    expect(historyCategory(mixed.get('amazon'))).toBeNull(); // 67%: ask
  });
  it('suggests merchants as you type, and for an amount', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    expect(suggestMerchants(p, 'sw', now).map((x) => x.merchant)).toEqual(['Swiggy']);
    expect(suggestMerchants(p, 'point', now).map((x) => x.merchant)).toEqual(['Chai Point']);
    expect(suggestMerchants(p, '', now)[0]!.merchant).toBe('Swiggy'); // used most
    expect(merchantsForAmount(p, 4_500).map((x) => x.merchant)).toEqual(['Chai Point']);
    expect(merchantsForAmount(p, 49_900).map((x) => x.merchant)).toEqual(['Netflix']);
    expect(merchantsForAmount(p, 77_700)).toEqual([]);
  });
});

describe('insights for a month (spec 0013)', () => {
  const month = [
    ...history,
    tx('Swiggy', 2400, '2026-11-15T21:00:00', { categoryId: FOOD }), // ~7x usual
    tx('Uber', 230, '2026-11-12T09:00:00'),
    tx('Uber', 230, '2026-11-12T09:10:00'), // charged twice?
  ];
  const r = moneyInsights({
    txs: month,
    month: '2026-11',
    timeZone: TZ,
    now: new Date('2026-11-20T12:00:00+05:30'),
    budgetMinor: 60_000_00,
    upcoming: [{ title: 'Rent', amountMinor: 15_000_00, direction: 'debit', date: '2026-11-25' }],
    tracked: [],
  });
  const kinds = r.cards.map((c) => c.kind);

  it('knows the pace, the forecast and what is safe to spend each day', () => {
    expect(r.pace.day).toBe(20);
    expect(r.pace.upcomingMinor).toBe(15_000_00);
    expect(r.pace.projectedMinor).toBeGreaterThan(r.pace.spentMinor + 15_000_00);
    // (60,000 − spent − 15,000 rent) over the 10 days left
    expect(r.pace.safePerDayMinor).toBe(Math.floor((60_000_00 - r.pace.spentMinor - 15_000_00) / 10));
    expect(kinds.slice(0, 2)).toEqual(['pace', 'safe']);
  });
  it('spots an unusual charge, a double charge, a price rise, a new subscription and a bill this week', () => {
    expect(r.cards.find((c) => c.kind === 'unusual')).toMatchObject({
      merchant: 'Swiggy',
      title: expect.stringMatching(/usually ₹350/),
    });
    expect(r.cards.find((c) => c.kind === 'duplicate')).toMatchObject({ merchant: 'Uber' });
    expect(r.cards.find((c) => c.kind === 'price')!.title).toMatch(/Netflix went up: ₹499 → ₹649/);
    expect(r.cards.find((c) => c.kind === 'new-subscription')).toMatchObject({ merchant: 'Netflix' });
    expect(r.cards.find((c) => c.kind === 'upcoming')!.title).toMatch(/Rent due this week · ₹15,000/);
    expect(r.cards.find((c) => c.kind === 'uncategorised')).toBeTruthy();
    // alerts before warnings, after the pace
    expect(kinds.indexOf('duplicate')).toBeLessThan(kinds.indexOf('unusual'));
  });
  it('a tracked subscription is not suggested again', () => {
    const again = moneyInsights({
      txs: month,
      month: '2026-11',
      timeZone: TZ,
      now: new Date('2026-11-20T12:00:00+05:30'),
      budgetMinor: null,
      upcoming: [],
      tracked: ['NETFLIX'],
    });
    expect(again.cards.some((c) => c.kind === 'new-subscription')).toBe(false);
    expect(again.pace.safePerDayMinor).toBeNull();
  });
});
