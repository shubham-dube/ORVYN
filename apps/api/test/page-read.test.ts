import { describe, expect, it } from 'vitest';
import { PageReadLoose } from '../src/modules/fill/fill.service';

describe('a page answer is tidied, not refused', () => {
  it('cuts what is too long and too many, reads points given as objects, drops bad actions', () => {
    const r = PageReadLoose.safeParse({
      summary: 'A plan that renews.',
      points: [...Array.from({ length: 15 }, (_, i) => `catch ${i}`), { text: 'never reached' }],
      actions: [
        { kind: 'task', text: 'Cancel before 1 Dec' },
        { kind: 'call', text: 'nope' },
        { kind: 'expense' },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      text: 'A plan that renews.',
      points: Array.from({ length: 12 }, (_, i) => `catch ${i}`),
      actions: [{ kind: 'task', text: 'Cancel before 1 Dec' }],
    });
    const long = PageReadLoose.safeParse({ text: 'x'.repeat(9000), points: [{ point: 'y'.repeat(900) }] });
    expect(long.success && [long.data.text.length, long.data.points[0]!.length]).toEqual([6000, 400]);
  });

  it('an empty answer is still no answer', () => {
    expect(PageReadLoose.safeParse({}).success).toBe(false);
    expect(PageReadLoose.safeParse({ text: '  ', points: [] }).success).toBe(false);
    expect(PageReadLoose.safeParse('not json').success).toBe(false);
  });
});
