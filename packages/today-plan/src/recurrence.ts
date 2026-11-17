import { instantAt, wallIn } from '@orvyn/today-parse';
import { RRule, rrulestr } from 'rrule';

/**
 * RFC 5545 repeats in the person's time zone. rrule.js works on "floating" times, so we feed it the wall-clock
 * time as if it were UTC and convert each occurrence back to a real instant in the zone (DST-correct).
 */
export interface Anchor {
  /** a day (date-only) … */
  date?: string | null;
  /** … or a moment (ISO) */
  at?: string | null;
  timeZone: string;
}

const floating = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function rule(rrule: string, start: Date): RRule {
  const body = rrule.replace(/^RRULE:/i, '');
  return rrulestr(`RRULE:${body}`, { dtstart: start }) as RRule;
}

function anchorFloating(a: Anchor): { start: Date; timed: boolean } {
  if (a.at) {
    const w = wallIn(new Date(a.at), a.timeZone);
    return { start: floating(w.y, w.m, w.d, w.h, w.mi), timed: true };
  }
  const [y, m, d] = (a.date ?? '1970-01-01').split('-').map(Number) as [number, number, number];
  return { start: floating(y, m, d), timed: false };
}

function toAnchor(f: Date, timed: boolean, tz: string): Anchor {
  return timed
    ? {
        at: instantAt(
          f.getUTCFullYear(),
          f.getUTCMonth() + 1,
          f.getUTCDate(),
          f.getUTCHours(),
          f.getUTCMinutes(),
          tz,
        ).toISOString(),
        timeZone: tz,
      }
    : { date: ymd(f), timeZone: tz };
}

/** Occurrences whose start falls in [from, to] (instants), minus exceptions (ISO instants or dates). */
export function occurrences(
  rrule: string,
  a: Anchor,
  from: Date,
  to: Date,
  exdates: string[] = [],
): Anchor[] {
  const { start, timed } = anchorFloating(a);
  // widen by a day each side in floating time; filter precisely afterwards
  const f = new Date(from.getTime() - 86_400_000 * 2);
  const t = new Date(to.getTime() + 86_400_000 * 2);
  const skip = new Set(exdates);
  return rule(rrule, start)
    .between(f, t, true)
    .map((o) => toAnchor(o, timed, a.timeZone))
    .filter((o) => {
      const ms = o.at ? Date.parse(o.at) : Date.parse(`${o.date}T00:00:00Z`);
      const key = o.at ?? o.date!;
      if (skip.has(key)) return false;
      return o.at ? ms >= from.getTime() && ms <= to.getTime() : o.date! >= ymd(from) && o.date! <= ymd(to);
    });
}

/**
 * Where a recurring task goes when it's ticked off: the next occurrence after its current one — and never one
 * that is already in the past (a habit missed for a week doesn't leave seven to catch up on).
 */
export function nextOccurrence(rrule: string, current: Anchor, now: Date): Anchor | null {
  const { start, timed } = anchorFloating(current);
  const r = rule(rrule, start);
  const w = wallIn(now, current.timeZone);
  const today = floating(w.y, w.m, w.d, timed ? w.h : 0, timed ? w.mi : 0);
  let next = r.after(start, false);
  // step past anything already gone (date-only: today still counts as "not past")
  let guard = 0;
  while (next && (timed ? next.getTime() <= today.getTime() : ymd(next) < ymd(today)) && guard++ < 1000) {
    next = r.after(next, false);
  }
  return next ? toAnchor(next, timed, current.timeZone) : null;
}

/** A short human description, used in chips and the task sheet. */
export function describeRepeat(rrule: string): string {
  try {
    return RRule.fromString(rrule.replace(/^RRULE:/i, '')).toText();
  } catch {
    return 'repeats';
  }
}
