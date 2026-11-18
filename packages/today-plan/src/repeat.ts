import { occurrences } from './recurrence';

/**
 * A repeat as a person describes it ("every 2 weeks on Mon and Wed, 10 times") — built from and turned back into an
 * RRULE, so tasks, events and scheduled money all share one builder and the summary reads the same everywhere.
 */
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const NAMES: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};
const LONG: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

export interface RepeatSpec {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  /** every N days/weeks/months/years */
  interval: number;
  /** weekly: which days (empty = the start day) */
  weekdays: Weekday[];
  /** monthly: on a date (1–31, −1 = last day) or on "the 2nd Friday" (n: 1–4 or −1 for last) */
  monthly: { kind: 'day'; day: number } | { kind: 'nth'; n: number; weekday: Weekday };
  end: { kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number };
}

export const defaultSpec = (freq: RepeatSpec['freq'] = 'WEEKLY'): RepeatSpec => ({
  freq,
  interval: 1,
  weekdays: [],
  monthly: { kind: 'day', day: 1 },
  end: { kind: 'never' },
});

/** The spec a start date suggests (weekly → that weekday, monthly → that date). */
export function specFor(freq: RepeatSpec['freq'], startDate: string): RepeatSpec {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const wd = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]!;
  return {
    ...defaultSpec(freq),
    weekdays: freq === 'WEEKLY' ? [wd] : [],
    monthly: { kind: 'day', day: d },
  };
}

export function buildRepeat(s: RepeatSpec): string {
  const p = [`FREQ=${s.freq}`];
  if (s.interval > 1) p.push(`INTERVAL=${s.interval}`);
  if (s.freq === 'WEEKLY' && s.weekdays.length)
    p.push(`BYDAY=${WEEKDAYS.filter((d) => s.weekdays.includes(d)).join(',')}`);
  if (s.freq === 'MONTHLY')
    p.push(
      s.monthly.kind === 'day' ? `BYMONTHDAY=${s.monthly.day}` : `BYDAY=${s.monthly.n}${s.monthly.weekday}`,
    );
  if (s.end.kind === 'until') p.push(`UNTIL=${s.end.date.replaceAll('-', '')}T235959Z`);
  if (s.end.kind === 'count') p.push(`COUNT=${s.end.count}`);
  return p.join(';');
}

/** Back to a spec; null when the rule uses something the builder can't show (it is then kept as written). */
export function parseRepeat(rrule: string): RepeatSpec | null {
  const parts = new Map<string, string>();
  for (const kv of rrule.replace(/^RRULE:/i, '').split(';')) {
    const i = kv.indexOf('=');
    if (i < 1) return null;
    parts.set(kv.slice(0, i).toUpperCase(), kv.slice(i + 1).toUpperCase());
  }
  const allowed = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT', 'WKST']);
  if ([...parts.keys()].some((k) => !allowed.has(k))) return null;
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const s = defaultSpec(freq);
  if (parts.has('INTERVAL')) {
    s.interval = Number(parts.get('INTERVAL'));
    if (!Number.isInteger(s.interval) || s.interval < 1 || s.interval > 99) return null;
  }
  const by = parts.get('BYDAY');
  if (freq === 'WEEKLY' && by) {
    const days = by.split(',');
    if (!days.every((d) => (WEEKDAYS as string[]).includes(d))) return null;
    s.weekdays = days as Weekday[];
  } else if (freq === 'MONTHLY') {
    const nth = by?.match(/^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/);
    if (by && !nth) return null;
    if (nth) s.monthly = { kind: 'nth', n: Number(nth[1]), weekday: nth[2] as Weekday };
    else if (parts.has('BYMONTHDAY')) {
      const day = Number(parts.get('BYMONTHDAY'));
      if (!Number.isInteger(day) || !((day >= 1 && day <= 31) || day === -1)) return null;
      s.monthly = { kind: 'day', day };
    }
  } else if (by || parts.has('BYMONTHDAY')) return null;
  const until = parts.get('UNTIL');
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/);
    if (!m) return null;
    s.end = { kind: 'until', date: `${m[1]}-${m[2]}-${m[3]}` };
  } else if (parts.has('COUNT')) {
    const count = Number(parts.get('COUNT'));
    if (!Number.isInteger(count) || count < 1) return null;
    s.end = { kind: 'count', count };
  }
  return s;
}

const ordinal = (n: number) => {
  if (n === -1) return 'last';
  const t = n % 100;
  const sfx =
    t >= 11 && t <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${sfx}`;
};
const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, day)));
};

/** "Every 2 weeks on Mon, Wed · until 31 Dec 2026" */
export function describeSpec(s: RepeatSpec): string {
  const n = s.interval;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[s.freq];
  let t = n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;
  if (s.freq === 'WEEKLY' && s.weekdays.length) {
    const w = WEEKDAYS.filter((d) => s.weekdays.includes(d));
    const weekdays = w.join() === 'MO,TU,WE,TH,FR';
    if (n === 1 && weekdays) t = 'Every weekday';
    else if (n === 1 && w.length === 7) t = 'Every day';
    else t += ` on ${w.map((d) => NAMES[d]).join(', ')}`;
  }
  if (s.freq === 'MONTHLY')
    t +=
      s.monthly.kind === 'day'
        ? s.monthly.day === -1
          ? ' on the last day'
          : ` on the ${ordinal(s.monthly.day)}`
        : ` on the ${ordinal(s.monthly.n)} ${LONG[s.monthly.weekday]}`;
  if (s.end.kind === 'until') t += ` · until ${longDate(s.end.date)}`;
  if (s.end.kind === 'count') t += ` · ${s.end.count} time${s.end.count === 1 ? '' : 's'}`;
  return t;
}

/** The first `n` dates a rule gives from a start date (shown as a preview, so a rule is never a surprise). */
export function nextDates(
  rrule: string,
  startDate: string,
  n: number,
  timeZone: string,
  from = startDate,
): string[] {
  try {
    const [y, m, d] = from.split('-').map(Number) as [number, number, number];
    const end = new Date(Date.UTC(y + 6, m - 1, d));
    return occurrences(rrule, { date: startDate, timeZone }, new Date(Date.UTC(y, m - 1, d)), end)
      .slice(0, n)
      .map((o) => o.date!);
  } catch {
    return [];
  }
}
