import { describe, expect, it } from 'vitest';
import { apportion, balances, settleUp, shares, SplitError } from '../src/split';

const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe('Split (spec 0011 AC4)', () => {
  it('equal: ₹100 among three is 33.34 + 33.33 + 33.33, never a paisa lost', () => {
    expect(apportion(10_000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(
      obj(
        shares({
          total: 10_000,
          method: 'equal',
          among: ['a', 'b', 'c'].map((memberId) => ({ memberId, value: 0 })),
        }),
      ),
    ).toEqual({
      a: 3334,
      b: 3333,
      c: 3333,
    });
  });

  it('shares: a couple counts as 2 — ₹6,000 hotel 2:1:1', () => {
    expect(
      obj(
        shares({
          total: 600_000,
          method: 'shares',
          among: [
            { memberId: 'couple', value: 2 },
            { memberId: 'ravi', value: 1 },
            { memberId: 'mia', value: 1 },
          ],
        }),
      ),
    ).toEqual({ couple: 300_000, ravi: 150_000, mia: 150_000 });
  });

  it('percent must add to 100; exact must add to the total', () => {
    expect(
      obj(
        shares({
          total: 99_999,
          method: 'percent',
          among: [
            { memberId: 'a', value: 50 },
            { memberId: 'b', value: 25 },
            { memberId: 'c', value: 25 },
          ],
        }),
      ),
    ).toEqual({ a: 49_999, b: 25_000, c: 25_000 }); // leftover paise go to the largest remainders
    expect(() =>
      shares({
        total: 1000,
        method: 'percent',
        among: [
          { memberId: 'a', value: 60 },
          { memberId: 'b', value: 30 },
        ],
      }),
    ).toThrow('percentages add up to 90, not 100');
    expect(() =>
      shares({
        total: 1000,
        method: 'exact',
        among: [
          { memberId: 'a', value: 600 },
          { memberId: 'b', value: 300 },
        ],
      }),
    ).toThrow(SplitError);
  });

  it('a trip: several payers, contributions, different splits, and a payment back', () => {
    const m = ['asha', 'ravi', 'mia', 'dev'];
    const net = balances(
      m,
      [
        // hotel ₹8,000: Asha paid 5,000 and Ravi 3,000; equal among 4
        {
          paid: [
            { memberId: 'asha', amount: 500_000 },
            { memberId: 'ravi', amount: 300_000 },
          ],
          owed: m.map((x) => ({ memberId: x, amount: 200_000 })),
        },
        // dinner ₹2,400 by Mia, only Mia, Dev and Asha ate
        {
          paid: [{ memberId: 'mia', amount: 240_000 }],
          owed: ['mia', 'dev', 'asha'].map((x) => ({ memberId: x, amount: 80_000 })),
        },
      ],
      [{ from: 'dev', to: 'asha', amount: 100_000 }],
    );
    expect(obj(net)).toEqual({
      asha: 220_000 - 100_000,
      ravi: 100_000,
      mia: -40_000,
      dev: -280_000 + 100_000,
    });
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(settleUp(net)).toEqual([
      { from: 'dev', to: 'asha', amount: 120_000 },
      { from: 'dev', to: 'ravi', amount: 60_000 },
      { from: 'mia', to: 'ravi', amount: 40_000 },
    ]);
  });

  it('settling up never needs more than n − 1 transfers and clears everyone', () => {
    const net = new Map([
      ['a', 500],
      ['b', -200],
      ['c', -200],
      ['d', -100],
      ['e', 0],
    ]);
    const plan = settleUp(net);
    expect(plan.length).toBeLessThanOrEqual(4);
    const after = balances([...net.keys()], [{ paid: [], owed: [] }], plan);
    for (const [k, v] of net)
      expect((after.get(k) ?? 0) + v).toBe(0 + (v ? 0 : 0) + (after.get(k)! + v === 0 ? 0 : 0));
    for (const [k, v] of net) expect(v + (after.get(k) ?? 0)).toBe(0);
  });
});
