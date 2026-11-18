import { describe, expect, it } from 'vitest';
import {
  matchCategory,
  merchantKey,
  myShare,
  readReply,
  suggestCategories,
  type ReviewCategory,
} from '../src/review';

const cats: ReviewCategory[] = [
  { id: 'food', name: 'Food & dining', slug: 'food', kind: 'expense' },
  { id: 'gro', name: 'Groceries', slug: 'groceries', kind: 'expense' },
  { id: 'tr', name: 'Transport', slug: 'transport', kind: 'expense' },
  { id: 'fuel', name: 'Fuel', slug: 'fuel', kind: 'expense' },
  { id: 'bills', name: 'Bills & utilities', slug: 'bills', kind: 'expense' },
  { id: 'pets', name: 'Pets', slug: null, kind: 'expense' },
  { id: 'sal', name: 'Salary', slug: 'salary', kind: 'income' },
];

describe('reading a reply', () => {
  it.each([
    ['food', { kind: 'category', categoryId: 'food', always: false, note: '' }],
    ['Food', { kind: 'category', categoryId: 'food', always: false, note: '' }],
    ['dinner', { kind: 'category', categoryId: 'food', always: false, note: '' }],
    ['petrol', { kind: 'category', categoryId: 'fuel', always: false, note: '' }],
    ['bill', { kind: 'category', categoryId: 'bills', always: false, note: '' }],
    ['pets', { kind: 'category', categoryId: 'pets', always: false, note: '' }],
    ['dog food for bruno', { kind: 'category', categoryId: 'food', always: false, note: '' }],
    ['always groceries', { kind: 'category', categoryId: 'gro', always: true, note: '' }],
    ['groceries always', { kind: 'category', categoryId: 'gro', always: true, note: '' }],
    [
      'food - dinner with Raj',
      { kind: 'category', categoryId: 'food', always: false, note: 'dinner with Raj' },
    ],
    ['split 3 food', { kind: 'category', categoryId: 'food', always: false, note: '', ways: 3 }],
    ['food split in two', { kind: 'category', categoryId: 'food', always: false, note: '', ways: 2 }],
    ['split 4', { kind: 'split', ways: 4, note: '' }],
    ['ignore', { kind: 'ignore', always: false }],
    ['not mine', { kind: 'ignore', always: false }],
    ['always ignore', { kind: 'ignore', always: true }],
    ['transfer', { kind: 'transfer', always: false }],
    ['to my own account', { kind: 'transfer', always: false }],
    ['asdfgh', { kind: 'unknown', text: 'asdfgh' }],
    ['', { kind: 'unknown', text: '' }],
  ])('%s', (text, want) => expect(readReply(text, cats)).toEqual(want));

  it('splits leave me the odd paise', () => {
    expect(myShare(100_00, 3)).toBe(3334);
    expect(myShare(24000, 2)).toBe(12000);
  });

  it('no match is no match', () => expect(matchCategory('xyz', cats)).toBeNull());
});

describe('suggestions', () => {
  it('this merchant before, then its name, then what I use most', () => {
    const history = [
      { merchantKey: 'swiggy', categoryId: 'food' },
      { merchantKey: 'swiggy', categoryId: 'food' },
      { merchantKey: 'swiggy', categoryId: 'gro' },
      { merchantKey: 'uber', categoryId: 'tr' },
      { merchantKey: 'uber', categoryId: 'tr' },
      { merchantKey: 'ola', categoryId: 'tr' },
    ];
    expect(
      suggestCategories({ merchant: 'SWIGGY', direction: 'debit' }, cats, history).map((c) => c.id),
    ).toEqual(['food', 'gro', 'tr']);
    expect(
      suggestCategories({ merchant: 'Indian Oil', direction: 'debit', guessSlug: 'fuel' }, cats, []).map(
        (c) => c.id,
      ),
    ).toEqual(['fuel', 'food', 'gro']);
    expect(
      suggestCategories({ merchant: 'ACME', direction: 'credit' }, cats, history).map((c) => c.id),
    ).toEqual(['sal']);
  });

  it('merchant keys ignore case, punctuation and long numbers', () => {
    expect(merchantKey('SWIGGY*Order 123456')).toBe('swiggy order');
    expect(merchantKey('Swiggy')).toBe('swiggy');
  });
});
