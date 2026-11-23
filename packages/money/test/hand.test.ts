import { describe, expect, it } from 'vitest';
import { hand, peopleBalances } from '../src/hand';

const at = (d: string) => new Date(`${d}T10:00:00+05:30`).toISOString();

/** The founder's own situation, in small: a bank, a card with ₹1.5 lakh due, cash taken out to lend to Rahul. */
const accounts = [
  {
    id: 'bank',
    name: 'HDFC',
    kind: 'bank',
    balanceMinor: 80_000_00,
    balanceAt: at('2026-11-01'),
    creditLimitMinor: null,
  },
  {
    id: 'card',
    name: 'ICICI card',
    kind: 'card',
    balanceMinor: 150_000_00,
    balanceAt: at('2026-11-01'),
    creditLimitMinor: 300_000_00,
  },
  {
    id: 'wallet',
    name: 'Paytm',
    kind: 'wallet',
    balanceMinor: null,
    balanceAt: null,
    creditLimitMinor: null,
  },
];
const txs = [
  // before the balance was set: already in it
  { amountMinor: 5_000_00, direction: 'debit', occurredAt: at('2026-10-30'), accountId: 'bank' },
  // salary in, groceries out
  { amountMinor: 60_000_00, direction: 'credit', occurredAt: at('2026-11-05'), accountId: 'bank' },
  { amountMinor: 3_000_00, direction: 'debit', occurredAt: at('2026-11-06'), accountId: 'bank' },
  // cash withdrawn on the card to give Rahul: the card's dues go up
  { amountMinor: 20_000_00, direction: 'debit', occurredAt: at('2026-11-07'), accountId: 'card' },
  // paid ₹50,000 of the card's bill from the bank: both go down
  {
    amountMinor: 50_000_00,
    direction: 'debit',
    occurredAt: at('2026-11-10'),
    accountId: 'bank',
    toAccountId: 'card',
  },
];
const ious = [
  {
    person: 'Rahul',
    direction: 'owed_to_me',
    amountMinor: 20_000_00,
    paidMinor: 5_000_00,
    sure: true,
    settledAt: null,
    dueDate: '2026-12-01',
  },
  {
    person: 'Asha',
    direction: 'owed_to_me',
    amountMinor: 3_000_00,
    paidMinor: 0,
    sure: false,
    settledAt: null,
  },
  { person: 'Rahul', direction: 'i_owe', amountMinor: 2_000_00, paidMinor: 0, sure: true, settledAt: null },
  {
    person: 'Old',
    direction: 'i_owe',
    amountMinor: 9_000_00,
    paidMinor: 0,
    sure: true,
    settledAt: at('2026-10-01'),
  },
];

describe("what's in my hand (spec 0014)", () => {
  const h = hand(accounts, txs, ious);
  it('moves each balance by what happened after it was set; a transfer leaves one and pays the other', () => {
    const by = Object.fromEntries(h.accounts.map((a) => [a.id, a]));
    expect(by.bank!.nowMinor).toBe(80_000_00 + 60_000_00 - 3_000_00 - 50_000_00); // 87,000
    expect(by.card!.nowMinor).toBe(150_000_00 + 20_000_00 - 50_000_00); // 1,20,000 due
    expect(by.card!.availableMinor).toBe(300_000_00 - 120_000_00);
    expect(by.wallet!.nowMinor).toBeNull();
    expect(h.unknown).toEqual(['Paytm']);
  });
  it('adds it up: cash − dues − what I owe + what will surely come', () => {
    expect(h.cashMinor).toBe(87_000_00);
    expect(h.duesMinor).toBe(120_000_00);
    expect(h.owedToMeSureMinor).toBe(15_000_00); // Rahul's 20k minus the 5k he paid
    expect(h.owedToMeMaybeMinor).toBe(3_000_00);
    expect(h.iOweMinor).toBe(2_000_00); // the settled one doesn't count
    expect(h.inHandTodayMinor).toBe(87_000_00 - 120_000_00 - 2_000_00);
    expect(h.inHandMinor).toBe(87_000_00 - 120_000_00 - 2_000_00 + 15_000_00);
  });
  it('nets each person across their debts', () => {
    expect(peopleBalances(ious)).toEqual([
      { person: 'Rahul', netMinor: 13_000_00, open: 2, nextDue: '2026-12-01' },
      { person: 'Asha', netMinor: 3_000_00, open: 1, nextDue: null },
    ]);
  });
});
