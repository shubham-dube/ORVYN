import { describe, expect, it } from 'vitest';
import { across, expectedGain, minLots, odds, shareOf, verdict } from '../src/modules/ipo/odds';

const sub = (
  o: Partial<Record<string, number | null>>,
  applications: Record<string, number> | null = null,
) => ({
  total: null,
  qib: null,
  nii: null,
  snii: null,
  bnii: null,
  retail: null,
  employee: null,
  shareholder: null,
  ...o,
  applications,
  updatedAt: null,
});

describe('IPO odds (spec 0010 AC2)', () => {
  it('minimum applications: retail 1 lot (SME 2), sNII the smallest lot count above ₹2 lakh', () => {
    expect(minLots('retail', 'mainboard', 148, 101)).toBe(1);
    expect(minLots('retail', 'sme', 148, 1000)).toBe(2);
    // a lot is ₹14,948: 13 lots = ₹1,94,324 (retail cap), so sNII starts at 14 lots
    expect(minLots('snii', 'mainboard', 148, 101)).toBe(14);
  });

  it('lots on offer from the issue size; with applications the chance is exact', () => {
    // ₹1,000 cr at ₹148, lot 101: retail 35% = 23,648,648 shares → 234,145 lots
    const [retail, snii] = odds({
      type: 'mainboard',
      price: 148,
      lotSize: 101,
      issueSizeCr: 1000,
      subscription: sub({ retail: 12.5, snii: 30 }, { retail: 2_341_450 }),
    });
    expect(retail).toMatchObject({ minLots: 1, minAmount: 14_948, lotsOnOffer: 234_145, basis: 'exact' });
    expect(retail!.chance).toBeCloseTo(0.1, 6);
    expect(snii).toMatchObject({ minLots: 14, basis: 'estimate' });
    expect(snii!.chance).toBeCloseTo(1 / 30, 6);
  });

  it('only the multiple: about one in “times”; undersubscribed: certain; before bidding: unknown', () => {
    const r = (retail: number | null) =>
      odds({
        type: 'mainboard',
        price: 100,
        lotSize: 150,
        issueSizeCr: 500,
        subscription: sub({ retail }),
      })[0]!;
    expect(r(40).chance).toBeCloseTo(0.025, 6);
    expect(r(0.8).chance).toBe(1);
    expect(r(null)).toMatchObject({ chance: null, basis: 'none', lotsOnOffer: 116_666 });
  });

  it('across accounts, and what a round is worth', () => {
    const a = across(8, 0.1);
    expect(a.expected).toBeCloseTo(0.8, 6);
    expect(a.atLeastOne).toBeCloseTo(1 - 0.9 ** 8, 6);
    // 8 accounts × 10% × 101 shares × ₹40 GMP − ₹375 card cost
    expect(expectedGain({ accounts: 8, chance: 0.1, minShares: 101, gmp: 40, cardCost: 375 })).toBe(2857);
  });

  it('profit shares by rule; nothing on a loss', () => {
    expect(shareOf({ kind: 'percent', value: 25 }, 2400)).toBe(600);
    expect(shareOf({ kind: 'fixed', value: 500 }, 2400)).toBe(500);
    expect(shareOf({ kind: 'fixed', value: 500 }, 300)).toBe(300);
    expect(shareOf({ kind: 'percent', value: 25 }, -800)).toBe(0);
    expect(shareOf({ kind: 'none', value: 0 }, 2400)).toBe(0);
  });

  it('a verdict line from the facts', () => {
    expect(
      verdict({
        status: 'open',
        gmpPct: 32,
        chance: 0.1,
        pool: { accounts: 8, expectedAllotments: 0.8, expectedGain: 2857 },
      }),
    ).toBe(
      'Strong GMP (32%) · retail odds ~10% · with 8 accounts ~0.8 allotments, +₹2,857 expected after costs.',
    );
    expect(verdict({ status: 'open', gmpPct: -2, chance: null, pool: null })).toBe(
      'GMP flat or negative — listing gains unlikely.',
    );
  });
});
