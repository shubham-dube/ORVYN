import { describe, expect, it } from 'vitest';
import { expandEvents } from '../src/events';

const ev = (id: string, f: Record<string, unknown>) =>
  ({
    id,
    title: id,
    location: '',
    allDay: false,
    start: null,
    end: null,
    startDate: null,
    endDate: null,
    timeZone: 'Asia/Kolkata',
    rrule: null,
    exdates: [],
    recurringEventId: null,
    originalStart: null,
    cancelled: false,
    calendarId: null,
    ...f,
  }) as Parameters<typeof expandEvents>[0][number];
const IST = (s: string) => new Date(`${s}+05:30`);
const week = [IST('2026-11-16T00:00:00'), IST('2026-11-23T00:00:00')] as const;

describe('events on the river', () => {
  it('a weekly standup, one cancelled, one moved; plus a single event and an all-day one', () => {
    const standup = ev('standup', {
      start: '2026-11-02T10:00:00+05:30',
      end: '2026-11-02T10:15:00+05:30',
      rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
      exdates: ['2026-11-17T04:30:00.000Z'], // Tue cancelled
    });
    const moved = ev('moved', {
      title: 'standup',
      start: '2026-11-18T11:00:00+05:30',
      end: '2026-11-18T11:15:00+05:30',
      recurringEventId: 'standup',
      originalStart: '2026-11-18T04:30:00.000Z',
    });
    const lunch = ev('lunch', { start: '2026-11-19T13:00:00+05:30', end: '2026-11-19T14:00:00+05:30' });
    const trip = ev('trip', { allDay: true, startDate: '2026-11-21', endDate: '2026-11-23' });
    const out = expandEvents([standup, moved, lunch, trip], ...week);
    const label = (i: (typeof out)[number]) =>
      i.allDay ? `${i.title} ${i.startDate}→${i.endDate}` : `${i.title} ${IST_(i.start!)}`;
    expect(out.map(label)).toEqual([
      'standup 16 10:00',
      'standup 18 11:00',
      'standup 19 10:00',
      'lunch 19 13:00',
      'standup 20 10:00',
      'trip 2026-11-21→2026-11-23',
    ]);
    expect(out[1]).toMatchObject({ eventId: 'moved', seriesId: 'standup' });
    expect(out[0]).toMatchObject({
      eventId: 'standup',
      seriesId: 'standup',
      occurrence: '2026-11-16T04:30:00.000Z',
    });
  });

  it('a repeating all-day birthday, and hidden calendars stay hidden', () => {
    const bday = ev('bday', {
      allDay: true,
      startDate: '2020-11-20',
      endDate: '2020-11-21',
      rrule: 'FREQ=YEARLY',
      calendarId: 'c1',
    });
    expect(expandEvents([bday], ...week).map((i) => i.startDate)).toEqual(['2026-11-20']);
    expect(expandEvents([bday], ...week, new Set(['c1']))).toEqual([]);
  });

  it('an event that started before the window but runs into it is included', () => {
    const late = ev('late', { start: '2026-11-15T23:00:00+05:30', end: '2026-11-16T01:00:00+05:30' });
    expect(expandEvents([late], ...week)).toHaveLength(1);
  });
});

function IST_(iso: string) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return p.replace(',', '').replace(/^(\d+) /, '$1 ');
}
