import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  budgetProgress,
  dailySpend,
  findTransferPairs,
  monthStory,
  subscriptions,
  summarise,
  type Tx,
} from '../src/insights';
import { occurredAtFor } from '../src/dates';
import { narrationPayee, parseStatement, statementDate } from '../src/csv';
import { dedupeKeyOf, findDuplicate } from '../src/parse';
import { parseSpend } from '../src/spend';

describe('typed entries', () => {
  it.each([
    [
      'spent 240 on lunch at swiggy',
      { amountMinor: 24000, direction: 'debit', merchant: 'Swiggy', category: 'food' },
    ],
    ['uber 180', { amountMinor: 18000, merchant: 'Uber', category: 'transport' }],
    ['1.2k groceries', { amountMinor: 120000, category: 'groceries' }],
    ['₹99.50 coffee', { amountMinor: 9950, category: 'food' }],
    ['got 500 from rahul', { amountMinor: 50000, direction: 'credit', merchant: 'Rahul' }],
    ['salary 85,000', { amountMinor: 8500000, direction: 'credit', category: 'salary' }],
  ])('%s', (text, want) => expect(parseSpend(text)).toMatchObject(want));
  it('no number, no entry', () => expect(parseSpend('lunch with priya')).toBeNull());
});

describe('one payment seen twice is one transaction (AC2)', () => {
  const sms = {
    id: 'a',
    amountMinor: 24000,
    direction: 'debit' as const,
    occurredAt: '2026-11-17T08:00:00Z',
    dedupeKey: 'ref:432112345678',
    source: 'sms',
  };
  it('the bank SMS and the GPay notification (no reference) within minutes', () => {
    const gpay = {
      amountMinor: 24000,
      direction: 'debit' as const,
      occurredAt: '2026-11-17T08:01:30Z',
      dedupeKey: null,
      source: 'notification',
    };
    expect(findDuplicate(gpay, [sms])?.id).toBe('a');
  });
  it('the same message read again, and a statement row with the same reference', () => {
    expect(findDuplicate({ ...sms, id: undefined }, [sms])?.id).toBe('a');
    const row = {
      amountMinor: 24000,
      direction: 'debit' as const,
      occurredAt: '2026-11-17T00:00:00Z',
      dedupeKey: 'ref:432112345678',
      source: 'statement',
    };
    expect(findDuplicate(row, [sms])?.id).toBe('a');
  });
  it('two real payments of the same amount are kept apart', () => {
    const later = {
      amountMinor: 24000,
      direction: 'debit' as const,
      occurredAt: '2026-11-17T09:00:00Z',
      dedupeKey: null,
      source: 'notification',
    };
    expect(findDuplicate(later, [sms])).toBeNull();
    const otherRef = { ...sms, id: undefined, dedupeKey: 'ref:432112349999', source: 'notification' };
    expect(findDuplicate(otherRef, [sms])).toBeNull();
    expect(dedupeKeyOf({ refNo: null })).toBeNull();
  });
});

describe('bank statements (CSV)', () => {
  it('HDFC: withdrawal/deposit columns, references from the narration', () => {
    const csv = `HDFC BANK Ltd.,,,,,,
Statement of accounts,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
17/11/26,UPI-SWIGGY-swiggy@icici-ICIC0001234-432112345678-UPI,0000432112345678,17/11/26,240.00,,12345.00
16/11/26,"NEFT CR-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY",CITIN26111600001,16/11/26,,"85,000.00",97345.00
,,,,,,
Generated on 18/11/26`;
    const { rows, skipped } = parseStatement(csv);
    expect(rows).toEqual([
      {
        date: '2026-11-17',
        description: 'UPI-SWIGGY-swiggy@icici-ICIC0001234-432112345678-UPI',
        amountMinor: 24000,
        direction: 'debit',
        refNo: '432112345678',
      },
      {
        date: '2026-11-16',
        description: 'NEFT CR-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY',
        amountMinor: 8500000,
        direction: 'credit',
        refNo: null,
      },
    ]);
    expect(skipped).toBe(2); // the blank row and the footer
    expect(narrationPayee(rows[0]!.description)).toBe('SWIGGY');
  });
  it('ICICI / SBI style debit + credit; a signed amount column', () => {
    expect(
      parseStatement(
        'Txn Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n17 Nov 2026,TO TRANSFER-UPI/DR/432167890123/CHAI POINT,,120.00,,5000',
      ).rows,
    ).toHaveLength(0);
    expect(statementDate('17-Nov-26')).toBe('2026-11-17');
    const signed = parseStatement('Date,Description,Amount\n2026-11-17,Netflix,-799\n2026-11-18,Refund,99.5');
    expect(signed.rows.map((r) => [r.direction, r.amountMinor])).toEqual([
      ['debit', 79900],
      ['credit', 9950],
    ]);
  });
});

describe('the month', () => {
  const tz = 'Asia/Kolkata';
  const t = (id: string, amt: number, at: string, cat: string | null, f: Partial<Tx> = {}): Tx => ({
    id,
    amountMinor: amt,
    direction: 'debit',
    occurredAt: at,
    merchant: '',
    categoryId: cat,
    transfer: false,
    ...f,
  });
  const txs = [
    t('1', 60000, '2026-11-02T10:00:00+05:30', 'food'),
    t('2', 40000, '2026-11-10T10:00:00+05:30', 'food'),
    t('3', 200000, '2026-11-05T10:00:00+05:30', 'rent'),
    t('4', 9000000, '2026-11-01T10:00:00+05:30', 'salary', { direction: 'credit' }),
    t('5', 500000, '2026-11-06T10:00:00+05:30', null, { transfer: true }),
    t('6', 30000, '2026-10-12T10:00:00+05:30', 'food'),
    t('7', 200000, '2026-10-05T10:00:00+05:30', 'rent'),
    t('8', 1000, '2026-10-31T23:30:00+05:30', 'food'), // still October in India
  ];
  it('spent and earned leave transfers out; by category; budgets in force', () => {
    const s = summarise(txs, '2026-11', tz);
    expect([s.spentMinor, s.earnedMinor]).toEqual([300000, 9000000]);
    expect(s.byCategory[0]).toEqual({ categoryId: 'rent', spentMinor: 200000, count: 1 });
    const b = budgetProgress(
      [
        { id: 'b1', categoryId: 'food', amountMinor: 80000, from: '2026-01' },
        { id: 'b2', categoryId: 'food', amountMinor: 120000, from: '2026-11' }, // raised from November
        { id: 'b3', categoryId: null, amountMinor: 250000, from: '2026-06' },
      ],
      s,
    );
    expect(b.map((x) => [x.budgetId, x.usedMinor, Math.round(x.ratio * 100)])).toEqual([
      ['b3', 300000, 120],
      ['b2', 100000, 83],
    ]);
  });
  it('what changed vs last month; subscriptions; transfers between own accounts', () => {
    const story = monthStory(txs, '2026-11', tz);
    expect(story.deltaMinor).toBe(300000 - 231000);
    expect(story.moves).toEqual([
      { categoryId: 'food', nowMinor: 100000, beforeMinor: 31000, deltaMinor: 69000 },
    ]);
    const subs = subscriptions(
      ['2026-08', '2026-09', '2026-10', '2026-11'].map((m, i) =>
        t(`n${i}`, 64900, `${m}-03T09:00:00+05:30`, 'subscriptions', { merchant: 'Netflix' }),
      ),
      '2026-11',
      tz,
    );
    expect(subs).toEqual([
      { merchant: 'Netflix', amountMinor: 64900, months: 4, lastAt: '2026-11-03T09:00:00+05:30' },
    ]);
    const pairs = findTransferPairs([
      { ...t('d', 500000, '2026-11-06T10:00:00Z', null), accountId: 'hdfc' },
      { ...t('c', 500000, '2026-11-06T10:03:00Z', null, { direction: 'credit' }), accountId: 'sbi' },
      { ...t('x', 500000, '2026-11-06T10:04:00Z', null, { direction: 'credit' }), accountId: 'hdfc' },
    ]);
    expect(pairs.map(([a, b]) => [a.id, b.id])).toEqual([['d', 'c']]);
  });
});

describe('typed entries with dates, shared with the Dart reader', () => {
  const f = JSON.parse(readFileSync(`${__dirname}/../fixtures/spend.json`, 'utf8')) as {
    now: string;
    timeZone: string;
    cases: { text: string; expect: Record<string, unknown> }[];
  };
  for (const c of f.cases)
    it(c.text, () => {
      const got = parseSpend(c.text, { now: new Date(f.now), timeZone: f.timeZone });
      expect(got).toMatchObject(c.expect);
      if (!('date' in c.expect)) return;
      expect(got!.date).toBe(c.expect.date ?? null);
    });
});

describe('when an entry happened', () => {
  const now = new Date('2026-11-18T10:00:00+05:30');
  it('is right now when no day is given, and the given time otherwise', () => {
    expect(occurredAtFor({ date: null, time: null }, now, 'Asia/Kolkata').toISOString()).toBe(
      now.toISOString(),
    );
    expect(occurredAtFor({ date: null, time: '08:15' }, now, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-18T02:45:00.000Z',
    );
    expect(occurredAtFor({ date: '2026-11-17', time: '14:30' }, now, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-17T09:00:00.000Z',
    );
  });
  it('is noon on another day with no time, so it stays on that day anywhere', () => {
    expect(occurredAtFor({ date: '2026-11-12', time: null }, now, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-12T06:30:00.000Z',
    );
    expect(occurredAtFor({ date: '2026-11-12', time: null }, now, 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-12T20:00:00.000Z',
    );
  });
  it('a day given as today with no time is still right now', () => {
    expect(occurredAtFor({ date: '2026-11-18', time: null }, now, 'Asia/Kolkata').toISOString()).toBe(
      now.toISOString(),
    );
  });
});

describe('daily spend for the dashboard chart', () => {
  const tx = (id: string, at: string, amountMinor: number, extra: Record<string, unknown> = {}) => ({
    id,
    amountMinor,
    direction: 'debit' as const,
    occurredAt: at,
    merchant: id,
    categoryId: null,
    transfer: false,
    ...extra,
  });
  it('is one number per day, skipping transfers and income, stopping at today', () => {
    const d = dailySpend(
      [
        tx('a', '2026-11-02T10:00:00+05:30', 24000),
        tx('b', '2026-11-02T20:00:00+05:30', 1000),
        tx('c', '2026-11-05T10:00:00+05:30', 5000, { transfer: true }),
        tx('d', '2026-11-05T11:00:00+05:30', 7000, { direction: 'credit' }),
        tx('e', '2026-10-31T23:00:00+05:30', 9000),
        tx('f', '2026-11-04T00:30:00+05:30', 300),
      ],
      '2026-11',
      'Asia/Kolkata',
      5,
    );
    expect(d.map((x) => x.spentMinor)).toEqual([0, 25000, 0, 300, 0]);
    expect(dailySpend([], '2026-02', 'Asia/Kolkata')).toHaveLength(28);
  });
});
