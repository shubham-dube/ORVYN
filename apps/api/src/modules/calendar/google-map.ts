import { type EventFields } from '@orvyn/contracts';
import { instantAt } from '@orvyn/today-parse';
import { v5 } from 'uuid';
import { type GEvent } from './google.client';

/** Fixed namespace: ORVYN's id for a Google event is derived from (calendar, Google id), so re-syncs never duplicate. */
const NS = '6f1d4c2a-9b7e-4d4f-8a3c-2e5b9d0c7a11';
export const eventIdFor = (calendarId: string, googleId: string) => v5(`${calendarId}|${googleId}`, NS);

const iso = (d: Date) => d.toISOString();
const compactUtc = (isoInstant: string) =>
  iso(new Date(isoInstant))
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const dashed = (yyyymmdd: string) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** One EXDATE line → ORVYN exceptions (ISO instants for timed series, dates for all-day ones). */
export function parseExdate(line: string, fallbackTz: string): string[] {
  const m = /^EXDATE(?<params>(;[^:]+)*):(?<values>.+)$/i.exec(line.trim());
  if (!m?.groups) return [];
  const tz = /;TZID=([^;:]+)/i.exec(m.groups.params ?? '')?.[1] ?? fallbackTz;
  return m.groups.values!.split(',').map((v) => {
    if (/^\d{8}$/.test(v)) return dashed(v);
    const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
    if (!t) return v;
    const [, y, mo, d, h, mi, , z] = t;
    return z ? `${y}-${mo}-${d}T${h}:${mi}:00.000Z` : iso(instantAt(+y!, +mo!, +d!, +h!, +mi!, tz));
  });
}

/**
 * Google → ORVYN fields. `seriesIdOf` turns a Google recurring-event id into ORVYN's id of that series.
 * Returns null for something to delete (a cancelled single event).
 */
export function fromGoogle(
  g: GEvent,
  o: { calendarId: string; calendarTz: string; seriesIdOf(googleId: string): string },
): Partial<EventFields> | null {
  const tz = g.start?.timeZone ?? g.originalStartTime?.timeZone ?? o.calendarTz;
  const base: Partial<EventFields> = {
    calendarId: o.calendarId,
    externalId: g.id,
    etag: g.etag ?? null,
  };
  const occurrence = g.originalStartTime
    ? (g.originalStartTime.date ?? iso(new Date(g.originalStartTime.dateTime!)))
    : null;
  if (g.status === 'cancelled') {
    if (!g.recurringEventId || !occurrence) return null;
    // one cancelled occurrence of a series: kept as a cancelled override so the series skips it
    return {
      ...base,
      title: 'Cancelled',
      cancelled: true,
      recurringEventId: o.seriesIdOf(g.recurringEventId),
      originalStart: occurrence,
      allDay: !!g.originalStartTime?.date,
      start: null,
      end: null,
      startDate: null,
      endDate: null,
    };
  }
  const allDay = !!g.start?.date;
  const rrule = g.recurrence?.find((l) => /^RRULE:/i.test(l))?.replace(/^RRULE:/i, '') ?? null;
  const exdates = (g.recurrence ?? []).filter((l) => /^EXDATE/i.test(l)).flatMap((l) => parseExdate(l, tz));
  return {
    ...base,
    title: (g.summary ?? '').trim() || '(no title)',
    notes: g.description ?? '',
    // a Meet call shows its link where the place would be (spec 0012 M: Join from the list); never written back
    location: g.location || g.hangoutLink || '',
    allDay,
    start: allDay ? null : iso(new Date(g.start!.dateTime!)),
    end: allDay ? null : iso(new Date(g.end!.dateTime!)),
    startDate: allDay ? g.start!.date! : null,
    endDate: allDay ? g.end!.date! : null,
    timeZone: tz,
    rrule,
    exdates,
    recurringEventId: g.recurringEventId ? o.seriesIdOf(g.recurringEventId) : null,
    originalStart: occurrence,
    cancelled: false,
  };
}

const MEET = /^https:\/\/meet\.google\.com\//;

/** ORVYN → Google body for insert/patch. */
export function toGoogle(e: EventFields): Partial<GEvent> {
  const body: Partial<GEvent> = {
    summary: e.title,
    description: e.notes,
    ...(MEET.test(e.location) ? {} : { location: e.location }),
    start: e.allDay ? { date: e.startDate! } : { dateTime: e.start!, timeZone: e.timeZone },
    end: e.allDay ? { date: e.endDate! } : { dateTime: e.end!, timeZone: e.timeZone },
  };
  if (e.rrule) {
    body.recurrence = [
      `RRULE:${e.rrule.replace(/^RRULE:/i, '')}`,
      ...e.exdates.map((x) =>
        x.length === 10 ? `EXDATE;VALUE=DATE:${x.replace(/-/g, '')}` : `EXDATE:${compactUtc(x)}`,
      ),
    ];
  }
  return body;
}

/** Google's id of one occurrence of a series: `<series id>_<original start>`. */
export function instanceId(seriesGoogleId: string, originalStart: string): string {
  return `${seriesGoogleId}_${originalStart.length === 10 ? originalStart.replace(/-/g, '') : compactUtc(originalStart)}`;
}
