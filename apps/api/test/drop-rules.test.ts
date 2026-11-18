import { describe, expect, it } from 'vitest';
import { readByRules } from '../src/modules/drop/rules';

const o = {
  now: new Date('2026-11-18T04:30:00Z'), // 10:00 in India
  timeZone: 'Asia/Kolkata',
  kinds: ['note', 'task', 'event', 'expense'],
  categories: [
    { name: 'Food & dining', slug: 'food' },
    { name: 'Transport', slug: 'transport' },
    { name: 'Rent', slug: 'rent' },
  ],
};

describe('Drop reads plain text without AI (spec 0007 C3)', () => {
  it('money, when it clearly is money', () => {
    expect(readByRules('spent 240 on lunch', o)).toMatchObject({
      kind: 'expense',
      amount: 240,
      category: 'Food & dining',
    });
    expect(readByRules('uber 180', o)).toMatchObject({ kind: 'expense', amount: 180, category: 'Transport' });
    expect(readByRules('paid ₹1,200 to the plumber', o)).toMatchObject({ kind: 'expense', amount: 1200 });
  });

  it('a day or a time makes a task; a meeting at a time is an event', () => {
    expect(readByRules('call mom tomorrow at 6pm', o)).toMatchObject({ kind: 'task', title: 'Call mom' });
    expect(readByRules('call mom at 6', o)).toMatchObject({ kind: 'task', title: 'Call mom' });
    expect(readByRules('pay rent 22000 on 1st', o)).toMatchObject({ kind: 'task' });
    expect(readByRules('renew passport next week', o)).toMatchObject({ kind: 'task', dueAt: null });
    expect(readByRules('meeting with Raj tomorrow 3pm', o)).toMatchObject({
      kind: 'event',
      start: '2026-11-19T09:30:00.000Z',
      end: '2026-11-19T10:30:00.000Z',
    });
  });

  it('everything else goes to the model', () => {
    for (const t of ['read 2 chapters', 'buy milk', 'an idea for the app: shared lists', '', 'x'.repeat(200)])
      expect(readByRules(t, { ...o, kinds: ['note', 'task', 'event', 'expense'] }), t).toBeNull();
  });

  it('only what the person has: no Money, no expense', () => {
    expect(readByRules('spent 240 on lunch', { ...o, kinds: ['note', 'task'] })).toBeNull();
  });
});
