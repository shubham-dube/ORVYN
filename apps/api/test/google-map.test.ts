import { type EventFields } from '@orvyn/contracts';
import { describe, expect, it } from 'vitest';
import {
  eventIdFor,
  fromGoogle,
  instanceId,
  parseExdate,
  toGoogle,
} from '../src/modules/calendar/google-map';

const o = { calendarId: 'c1', calendarTz: 'Asia/Kolkata', seriesIdOf: (g: string) => `orvyn-${g}` };

describe('Google ↔ ORVYN event mapping', () => {
  it('ids are stable per calendar and Google id', () => {
    expect(eventIdFor('c1', 'abc')).toBe(eventIdFor('c1', 'abc'));
    expect(eventIdFor('c1', 'abc')).not.toBe(eventIdFor('c2', 'abc'));
  });

  it('a weekly series with exceptions in its own zone', () => {
    const f = fromGoogle(
      {
        id: 'g1',
        etag: '"e1"',
        summary: 'Standup',
        start: { dateTime: '2026-11-02T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2026-11-02T10:15:00+05:30', timeZone: 'Asia/Kolkata' },
        recurrence: [
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
          'EXDATE;TZID=Asia/Kolkata:20261109T100000,20261116T100000',
        ],
      },
      o,
    )!;
    expect(f).toMatchObject({
      title: 'Standup',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      start: '2026-11-02T04:30:00.000Z',
      exdates: ['2026-11-09T04:30:00.000Z', '2026-11-16T04:30:00.000Z'],
      externalId: 'g1',
      etag: '"e1"',
      timeZone: 'Asia/Kolkata',
    });
    expect(toGoogle({ ...(f as EventFields), notes: '', location: '' }).recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'EXDATE:20261109T043000Z',
      'EXDATE:20261116T043000Z',
    ]);
  });

  it('a moved and a cancelled occurrence point at their series', () => {
    const moved = fromGoogle(
      {
        id: 'g1_20261123T043000Z',
        recurringEventId: 'g1',
        originalStartTime: { dateTime: '2026-11-23T10:00:00+05:30' },
        summary: 'Standup',
        start: { dateTime: '2026-11-23T11:00:00+05:30' },
        end: { dateTime: '2026-11-23T11:15:00+05:30' },
      },
      o,
    )!;
    expect(moved).toMatchObject({ recurringEventId: 'orvyn-g1', originalStart: '2026-11-23T04:30:00.000Z' });
    const cancelled = fromGoogle(
      { id: 'x', status: 'cancelled', recurringEventId: 'g1', originalStartTime: { date: '2026-11-30' } },
      o,
    )!;
    expect(cancelled).toMatchObject({
      cancelled: true,
      originalStart: '2026-11-30',
      recurringEventId: 'orvyn-g1',
    });
    expect(fromGoogle({ id: 'gone', status: 'cancelled' }, o)).toBeNull();
  });

  it('all-day events and instance ids', () => {
    const f = fromGoogle(
      { id: 'b', summary: 'Trip', start: { date: '2026-11-21' }, end: { date: '2026-11-23' } },
      o,
    )!;
    expect(f).toMatchObject({ allDay: true, startDate: '2026-11-21', endDate: '2026-11-23', start: null });
    expect(toGoogle({ ...(f as EventFields), exdates: [], rrule: null })).toMatchObject({
      start: { date: '2026-11-21' },
    });
    expect(instanceId('g1', '2026-11-23T04:30:00.000Z')).toBe('g1_20261123T043000Z');
    expect(instanceId('b', '2026-11-30')).toBe('b_20261130');
    expect(parseExdate('EXDATE;VALUE=DATE:20261130,20261207', 'UTC')).toEqual(['2026-11-30', '2026-12-07']);
  });
});
