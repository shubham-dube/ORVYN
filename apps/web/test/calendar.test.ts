import { describe, expect, it } from 'vitest';
import { freeRanges, layout, monthGrid, snapAt, taskBlocks, weekOf } from '@/lib/calendar';

describe('calendar maths', () => {
  it('overlapping blocks share the width; separate clusters get full width', () => {
    const b = (key: string, start: number, end: number) => ({
      key,
      kind: 'event' as const,
      id: key,
      title: key,
      start,
      end,
    });
    const out = layout([b('a', 600, 660), b('b', 630, 700), b('c', 640, 650), b('d', 720, 780)]);
    const by = Object.fromEntries(out.map((x) => [x.key, [x.col, x.cols]]));
    expect(by).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] });
  });

  it('free time is working hours minus busy, from now on, at least 15 minutes', () => {
    const working = [
      { start: '10:00', end: '13:00' },
      { start: '14:00', end: '19:00' },
    ];
    const busy = [
      { start: 600, end: 630 },
      { start: 640, end: 700 },
      { start: 840, end: 1140 },
    ];
    expect(freeRanges(working, busy, 0)).toEqual([{ start: 700, end: 780 }]);
    expect(freeRanges(working, [], 750)).toEqual([
      { start: 750, end: 780 },
      { start: 840, end: 1140 },
    ]);
  });

  it('snaps to quarter hours', () => {
    expect(snapAt(56 * 9 + 20)).toBe(9 * 60 + 15);
    expect(snapAt(-10)).toBe(0);
  });

  it('weeks start on Monday; a month view is six full weeks', () => {
    expect(weekOf('2026-11-18')[0]).toBe('2026-11-16');
    const g = monthGrid('2026-11-18');
    expect([g[0], g.length, g[41]]).toEqual(['2026-10-26', 42, '2026-12-06']);
  });

  it('timed tasks become blocks on their day', () => {
    const t = (f: object) =>
      ({
        id: 'x',
        title: 'x',
        completedAt: null,
        scheduledStart: null,
        dueAt: null,
        durationMin: null,
        ...f,
      }) as never;
    const at = new Date(2026, 10, 16, 15, 0).toISOString();
    expect(taskBlocks([t({ dueAt: at })], '2026-11-16')).toMatchObject([{ start: 900, end: 930 }]);
    expect(taskBlocks([t({ scheduledStart: at, durationMin: 90 })], '2026-11-16')).toMatchObject([
      { start: 900, end: 990 },
    ]);
    expect(taskBlocks([t({ dueAt: at })], '2026-11-17')).toEqual([]);
  });
});
