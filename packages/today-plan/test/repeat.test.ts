import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRepeat, defaultSpec, describeSpec, nextDates, parseRepeat, specFor } from '../src';

describe('repeat builder', () => {
  it('builds rules people can read back', () => {
    expect(buildRepeat(defaultSpec('DAILY'))).toBe('FREQ=DAILY');
    expect(buildRepeat({ ...defaultSpec('WEEKLY'), interval: 2, weekdays: ['WE', 'MO'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    );
    expect(buildRepeat({ ...defaultSpec('MONTHLY'), monthly: { kind: 'nth', n: 2, weekday: 'FR' } })).toBe(
      'FREQ=MONTHLY;BYDAY=2FR',
    );
    expect(
      buildRepeat({
        ...defaultSpec('MONTHLY'),
        monthly: { kind: 'day', day: -1 },
        end: { kind: 'count', count: 6 },
      }),
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6');
    expect(buildRepeat({ ...defaultSpec('YEARLY'), end: { kind: 'until', date: '2030-03-01' } })).toBe(
      'FREQ=YEARLY;UNTIL=20300301T235959Z',
    );
  });

  it('round-trips every rule it builds, and refuses what it cannot show', () => {
    for (const r of [
      'FREQ=DAILY',
      'FREQ=DAILY;INTERVAL=3',
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
      'FREQ=MONTHLY;BYMONTHDAY=5',
      'FREQ=MONTHLY;BYDAY=-1FR;COUNT=4',
      'FREQ=YEARLY;UNTIL=20300301T235959Z',
    ])
      expect(buildRepeat(parseRepeat(r)!)).toBe(r);
    expect(parseRepeat('RRULE:FREQ=WEEKLY;BYDAY=MO')?.weekdays).toEqual(['MO']);
    expect(parseRepeat('FREQ=HOURLY')).toBeNull();
    expect(parseRepeat('FREQ=YEARLY;BYMONTH=3')).toBeNull();
    expect(parseRepeat('FREQ=WEEKLY;BYDAY=5MO')).toBeNull();
    expect(parseRepeat('nonsense')).toBeNull();
  });

  it('says it in words', () => {
    expect(describeSpec(parseRepeat('FREQ=DAILY')!)).toBe('Every day');
    expect(describeSpec(parseRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')!)).toBe('Every weekday');
    expect(describeSpec(parseRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')!)).toBe(
      'Every 2 weeks on Mon, Wed',
    );
    expect(describeSpec(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=22')!)).toBe('Every month on the 22nd');
    expect(describeSpec(parseRepeat('FREQ=MONTHLY;BYMONTHDAY=11')!)).toBe('Every month on the 11th');
    expect(describeSpec(parseRepeat('FREQ=MONTHLY;BYDAY=-1FR;COUNT=1')!)).toBe(
      'Every month on the last Friday · 1 time',
    );
    expect(describeSpec(parseRepeat('FREQ=YEARLY;UNTIL=20301231T235959Z')!)).toBe(
      'Every year · until 31 Dec 2030',
    );
  });

  it('suggests a spec from the start date', () => {
    expect(specFor('WEEKLY', '2026-11-18').weekdays).toEqual(['WE']);
    expect(specFor('MONTHLY', '2026-11-18').monthly).toEqual({ kind: 'day', day: 18 });
  });

  it('previews the next dates, honouring the end', () => {
    expect(nextDates('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31', 4, 'Asia/Kolkata')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    expect(nextDates('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3', '2026-11-18', 9, 'Asia/Kolkata')).toEqual([
      '2026-11-18',
      '2026-11-23',
      '2026-11-25',
    ]);
    expect(nextDates('FREQ=DAILY;UNTIL=20261120T235959Z', '2026-11-18', 9, 'Asia/Kolkata')).toEqual([
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
    expect(nextDates('FREQ=BAD', '2026-11-18', 3, 'Asia/Kolkata')).toEqual([]);
  });
});

describe('repeat fixtures shared with the Android app', () => {
  const f = JSON.parse(readFileSync(new URL('../fixtures/repeat.json', import.meta.url), 'utf8')) as {
    summaries: { rrule: string; text: string }[];
    unreadable: string[];
    previews: { rrule: string; start: string; n: number; dates: string[] }[];
  };
  it.each(f.summaries)('$rrule → $text', ({ rrule, text }) => {
    expect(describeSpec(parseRepeat(rrule)!)).toBe(text);
    expect(buildRepeat(parseRepeat(rrule)!)).toBe(rrule);
  });
  it.each(f.unreadable)('%s is left as it is', (r) => expect(parseRepeat(r)).toBeNull());
  it.each(f.previews)('$rrule from $start', ({ rrule, start, n, dates }) =>
    expect(nextDates(rrule, start, n, 'Asia/Kolkata')).toEqual(dates),
  );
});
