import { describe, expect, it } from 'vitest';
import { doneDayHeader, doneLabel } from '../src/today';

const now = new Date('2026-11-22T12:00:00+05:30'); // Sunday
const tz = 'Asia/Kolkata';
const at = (s: string) => new Date(`${s}+05:30`).toISOString();

describe('doneLabel (spec 0012 A1)', () => {
  it.each([
    ['2026-11-22T15:40:00', 'Done 3:40 pm'],
    ['2026-11-22T00:05:00', 'Done 12:05 am'],
    ['2026-11-21T18:10:00', 'Done yesterday, 6:10 pm'],
    ['2026-11-16T09:00:00', 'Done Mon, 9:00 am'],
    ['2026-11-12T09:00:00', 'Done 12 Nov'],
    ['2025-11-18T09:00:00', 'Done 18 Nov 2025'],
  ])('%s → %s', (s, want) => expect(doneLabel(at(s), now, tz)).toBe(want));

  it('reads the day in the person zone, not UTC', () => {
    // 00:30 IST on the 22nd is still the 21st in UTC
    expect(doneLabel(at('2026-11-22T00:30:00'), now, tz)).toBe('Done 12:30 am');
  });

  it('has a long form for the task sheet', () => {
    expect(doneLabel(at('2026-11-16T18:10:00'), now, tz, true)).toBe('Done on Mon 16 Nov, 6:10 pm');
    expect(doneLabel(at('2025-11-18T18:10:00'), now, tz, true)).toBe('Done on Tue 18 Nov 2025, 6:10 pm');
  });

  it('groups under day headers', () => {
    expect(doneDayHeader(at('2026-11-22T08:00:00'), now, tz)).toBe('Today');
    expect(doneDayHeader(at('2026-11-21T23:59:00'), now, tz)).toBe('Yesterday');
    expect(doneDayHeader(at('2026-11-16T08:00:00'), now, tz)).toBe('Mon 16 Nov');
  });
});
