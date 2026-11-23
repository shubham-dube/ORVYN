import { type CalEvent } from '@orvyn/contracts';
import { addDays } from '@orvyn/today-parse';
import { occurrences } from './recurrence';

/** One thing on the river: a single event, or one occurrence of a repeating one. */
export interface Instance {
  /** the event row this instance comes from (the series for an occurrence, the override for a changed one) */
  eventId: string;
  /** the series, when it repeats */
  seriesId: string | null;
  /** which occurrence: its original start (ISO instant, or date for all-day) */
  occurrence: string | null;
  title: string;
  location: string;
  calendarId: string | null;
  allDay: boolean;
  /** timed: instants */
  start: string | null;
  end: string | null;
  /** all-day: dates, end exclusive */
  startDate: string | null;
  endDate: string | null;
}

type Ev = Pick<
  CalEvent,
  | 'id'
  | 'title'
  | 'location'
  | 'allDay'
  | 'start'
  | 'end'
  | 'startDate'
  | 'endDate'
  | 'timeZone'
  | 'rrule'
  | 'exdates'
  | 'recurringEventId'
  | 'originalStart'
  | 'cancelled'
  | 'calendarId'
>;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const ymdUtc = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Everything that overlaps [from, to): single events, occurrences of repeating ones (minus cancelled ones and the
 * ones that were changed, which appear as their own events), sorted by start. All-day events come first on a day.
 */
export function expandEvents(
  events: Ev[],
  from: Date,
  to: Date,
  hidden: ReadonlySet<string> = new Set(),
): Instance[] {
  const overrides = new Set(
    events
      .filter((e) => e.recurringEventId && e.originalStart)
      .map((e) => `${e.recurringEventId}|${e.originalStart}`),
  );
  const out: Instance[] = [];
  const base = (e: Ev) => ({
    eventId: e.id,
    title: e.title,
    location: e.location,
    calendarId: e.calendarId,
    allDay: e.allDay,
  });
  const fromDay = ymdUtc(new Date(from.getTime() - 14 * 3_600_000));
  const toDay = ymdUtc(new Date(to.getTime() + 14 * 3_600_000));
  const overlaps = (i: Pick<Instance, 'allDay' | 'start' | 'end' | 'startDate' | 'endDate'>) =>
    i.allDay
      ? i.startDate! <= toDay && i.endDate! > fromDay
      : Date.parse(i.start!) < to.getTime() && Date.parse(i.end!) > from.getTime();

  for (const e of events) {
    if (e.cancelled || (e.calendarId && hidden.has(e.calendarId))) continue;
    if (!e.rrule) {
      const i: Instance = {
        ...base(e),
        seriesId: e.recurringEventId,
        occurrence: e.originalStart,
        start: e.start,
        end: e.end,
        startDate: e.startDate,
        endDate: e.endDate,
      };
      if ((e.allDay ? e.startDate && e.endDate : e.start && e.end) && overlaps(i)) out.push(i);
      continue;
    }
    if (e.allDay) {
      if (!e.startDate || !e.endDate) continue;
      const span = daysBetween(e.startDate, e.endDate);
      const occ = occurrences(
        e.rrule,
        { date: e.startDate, timeZone: e.timeZone },
        new Date(from.getTime() - span * 86_400_000),
        to,
        e.exdates,
      );
      for (const o of occ) {
        if (overrides.has(`${e.id}|${o.date}`)) continue;
        const i: Instance = {
          ...base(e),
          seriesId: e.id,
          occurrence: o.date!,
          start: null,
          end: null,
          startDate: o.date!,
          endDate: addDays(o.date!, span),
        };
        if (overlaps(i)) out.push(i);
      }
    } else {
      if (!e.start || !e.end) continue;
      const len = Date.parse(e.end) - Date.parse(e.start);
      const occ = occurrences(
        e.rrule,
        { at: e.start, timeZone: e.timeZone },
        new Date(from.getTime() - len),
        to,
        e.exdates,
      );
      for (const o of occ) {
        if (overrides.has(`${e.id}|${o.at}`)) continue;
        // exdates may be written as the exact instant in any offset form
        if ((e.exdates ?? []).some((x) => x.length > 10 && Date.parse(x) === Date.parse(o.at!))) continue;
        const i: Instance = {
          ...base(e),
          seriesId: e.id,
          occurrence: o.at!,
          start: o.at!,
          end: new Date(Date.parse(o.at!) + len).toISOString(),
          startDate: null,
          endDate: null,
        };
        if (overlaps(i)) out.push(i);
      }
    }
  }
  const key = (i: Instance) =>
    i.allDay ? `${i.startDate}T00:00:00.000Z#0` : `${new Date(i.start!).toISOString()}#1`;
  // the same event on several calendars (a holiday each Google account adds, a meeting you're invited to from
  // two accounts) shows once (spec 0014)
  const seen = new Set<string>();
  const once = out.filter((i) => {
    const k = `${i.title.trim().toLowerCase()}|${i.allDay ? `${i.startDate}|${i.endDate}` : `${i.start}|${i.end}`}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return once.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
}
