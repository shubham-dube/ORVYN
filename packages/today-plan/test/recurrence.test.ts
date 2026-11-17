import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrences } from '../src/recurrence';

const IST = 'Asia/Kolkata';
const now = new Date('2026-11-16T09:30:00+05:30'); // Monday

describe('repeats in the person’s time zone', () => {
  it('monthly on the 1st, date-only', () => {
    const o = occurrences(
      'FREQ=MONTHLY;BYMONTHDAY=1',
      { date: '2026-12-01', timeZone: IST },
      new Date('2026-11-01T00:00:00Z'),
      new Date('2027-03-15T00:00:00Z'),
    );
    expect(o.map((x) => x.date)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']);
  });

  it('weekly Mon/Wed/Fri at 7:00 keeps 7:00 IST', () => {
    const o = occurrences(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      { at: '2026-11-18T01:30:00.000Z', timeZone: IST },
      new Date('2026-11-16T00:00:00Z'),
      new Date('2026-11-23T23:59:00Z'),
    );
    expect(o.map((x) => x.at)).toEqual([
      '2026-11-18T01:30:00.000Z',
      '2026-11-20T01:30:00.000Z',
      '2026-11-23T01:30:00.000Z',
    ]);
  });

  it('keeps the wall clock across a DST change (New York)', () => {
    const NY = 'America/New_York';
    const o = occurrences(
      'FREQ=WEEKLY',
      { at: '2026-10-26T13:00:00.000Z', timeZone: NY },
      new Date('2026-10-20T00:00:00Z'),
      new Date('2026-11-10T00:00:00Z'),
    );
    // 9:00 EDT, then 9:00 EST after 1 Nov
    expect(o.map((x) => x.at)).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-09T14:00:00.000Z',
    ]);
  });

  it('exceptions remove one occurrence', () => {
    const o = occurrences(
      'FREQ=DAILY',
      { date: '2026-11-16', timeZone: IST },
      new Date('2026-11-16T00:00:00Z'),
      new Date('2026-11-19T00:00:00Z'),
      ['2026-11-17'],
    );
    expect(o.map((x) => x.date)).toEqual(['2026-11-16', '2026-11-18', '2026-11-19']);
  });
});

describe('ticking off a recurring task rolls it forward', () => {
  it('to the next occurrence', () => {
    expect(nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=1', { date: '2026-12-01', timeZone: IST }, now)).toEqual({
      date: '2027-01-01',
      timeZone: IST,
    });
    expect(
      nextOccurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', { at: '2026-11-16T01:30:00.000Z', timeZone: IST }, now)
        ?.at,
    ).toBe('2026-11-18T01:30:00.000Z');
  });
  it('never into the past: a habit missed for a week has one next time, not seven', () => {
    expect(nextOccurrence('FREQ=DAILY', { date: '2026-11-09', timeZone: IST }, now)).toEqual({
      date: '2026-11-16',
      timeZone: IST,
    });
    expect(nextOccurrence('FREQ=DAILY', { at: '2026-11-09T02:30:00.000Z', timeZone: IST }, now)?.at).toBe(
      '2026-11-17T02:30:00.000Z',
    ); // 8:00 today already passed
  });
  it('last day of the month', () => {
    expect(
      nextOccurrence('FREQ=MONTHLY;BYMONTHDAY=-1', { date: '2026-11-30', timeZone: IST }, now)?.date,
    ).toBe('2026-12-31');
  });
  it('a rule that has ended returns nothing', () => {
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', { date: '2026-11-16', timeZone: IST }, now)).toBeNull();
  });
});
