/**
 * Dates in a typed expense ("yesterday", "on 12 nov", "last friday", "3 days ago", "5th"). Spending is in the past, so
 * a day name means the latest such day and "12 nov" means the latest 12 November that isn't in the future.
 * The Dart reader (apps/mobile/lib/money/spend_date.dart) follows the same rules against the same fixtures.
 */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export const ymdString = ({ y, m, d }: Ymd) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const utc = ({ y, m, d }: Ymd) => new Date(Date.UTC(y, m - 1, d));
const fromUtc = (dt: Date): Ymd => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
export const addDays = (a: Ymd, n: number): Ymd => fromUtc(new Date(utc(a).getTime() + n * 86_400_000));
const weekday = (a: Ymd) => utc(a).getUTCDay(); // 0 = Sunday
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const before = (a: Ymd, b: Ymd) => utc(a).getTime() < utc(b).getTime();

/** Today's date in a time zone (the person's, not the server's). */
export function todayIn(timeZone: string, now: Date): Ymd {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: g('year'), m: g('month'), d: g('day') };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY =
  '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)';

export interface FoundDate {
  date: Ymd;
  /** the words that were the date, with the "on"/"last" in front, to remove from the text */
  span: [number, number];
}

/** The latest day on or before today that is `month`/`day`; in the previous year if this year's is still ahead. */
function latest(today: Ymd, m: number, d: number, y?: number): Ymd | null {
  if (d < 1 || m < 1 || m > 12) return null;
  const year = y ?? today.y;
  if (d > daysIn(year, m)) return null;
  const c = { y: year, m, d };
  if (y === undefined && before(today, c)) return d > daysIn(year - 1, m) ? null : { y: year - 1, m, d };
  return c;
}

/** First date phrase in the text, or null. */
export function findDate(text: string, today: Ymd): FoundDate | null {
  const rules: [RegExp, (m: RegExpExecArray) => Ymd | null][] = [
    [/\b(?:the\s+)?day before yesterday\b|\bparso\b/i, () => addDays(today, -2)],
    [/\byesterday\b|\bkal\b/i, () => addDays(today, -1)],
    [/\btoday\b|\baaj\b/i, () => today],
    [
      /\b(\d{1,3}|a|one|two|three|four|five|six|seven)\s+days?\s+ago\b/i,
      (m) => addDays(today, -wordNum(m[1]!)),
    ],
    [/\b(\d{1,2}|a|one|two|three|four)\s+weeks?\s+ago\b/i, (m) => addDays(today, -7 * wordNum(m[1]!))],
    [/\blast\s+week\b/i, () => addDays(today, -7)],
    [
      new RegExp(`\\b(?:last\\s+|on\\s+|this\\s+past\\s+)?${DAY}\\b`, 'i'),
      (m) => {
        const target = DAYS.indexOf(m[1]!.slice(0, 3).toLowerCase());
        let back = (weekday(today) - target + 7) % 7;
        if (back === 0 && /^last\b/i.test(m[0]!)) back = 7;
        return addDays(today, -back);
      },
    ],
    // 12 nov 2026 · 12th nov · nov 12 · 12 november
    [
      new RegExp(
        `\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?:\\s*,?\\s*(\\d{4}))?\\b`,
        'i',
      ),
      (m) =>
        latest(
          today,
          MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1,
          Number(m[1]),
          m[3] ? Number(m[3]) : undefined,
        ),
    ],
    [
      new RegExp(`\\b(?:on\\s+)?${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'i'),
      (m) =>
        latest(
          today,
          MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1,
          Number(m[2]),
          m[3] ? Number(m[3]) : undefined,
        ),
    ],
    // 12/11 · 12-11-26 · 12.11.2026 (day first, as in India). A dot only counts in the full form, so 1.2k stays money.
    [
      /\b(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d/-])|\b(?:on\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?![\d])/,
      (m) => {
        const d = Number(m[1] ?? m[4]);
        const mo = Number(m[2] ?? m[5]);
        const yy = m[3] ?? m[6];
        const y = yy ? (yy.length === 2 ? 2000 + Number(yy) : Number(yy)) : undefined;
        return latest(today, mo, d, y);
      },
    ],
    // "on the 5th" / "5th": this month's 5th, or last month's if it hasn't come yet
    [
      /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i,
      (m) => {
        const d = Number(m[1]);
        if (d < 1 || d > 31) return null;
        const here = { y: today.y, m: today.m, d };
        if (d <= daysIn(today.y, today.m) && !before(today, here)) return here;
        const py = today.m === 1 ? today.y - 1 : today.y;
        const pm = today.m === 1 ? 12 : today.m - 1;
        return d <= daysIn(py, pm) ? { y: py, m: pm, d } : null;
      },
    ],
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (date) return { date, span: [m.index, m.index + m[0].length] };
  }
  return null;
}

const WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const wordNum = (s: string) => WORDS[s.toLowerCase()] ?? Number(s);

/** "at 3pm" · "3:30 pm" · "15:30" → "HH:MM" */
export function findTime(text: string): { time: string; span: [number, number] } | null {
  const m =
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text) ??
    /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return {
    time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    span: [m.index, m.index + m[0].length],
  };
}

/** The instant at a wall-clock time in a zone (same method as today-parse, kept here so this package stands alone). */
function instantAt(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const offset = (at: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return (
      (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) -
        Math.floor(at.getTime() / 60000) * 60000) /
      60000
    );
  };
  let guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  for (let i = 0; i < 2; i++) guess = new Date(Date.UTC(y, m - 1, d, h, mi) - offset(guess) * 60000);
  return guess;
}

/**
 * When an entry happened, as an instant: its day and time if given; today with no time = right now; another day with
 * no time = noon (so it lands on that day in every zone). Shared by web and Android.
 */
export function occurredAtFor(
  e: { date: string | null; time: string | null },
  now: Date,
  timeZone: string,
): Date {
  const today = todayIn(timeZone, now);
  const [y, m, d] = e.date
    ? (e.date.split('-').map(Number) as [number, number, number])
    : [today.y, today.m, today.d];
  const isToday = y === today.y && m === today.m && d === today.d;
  if (!e.time) return isToday ? now : instantAt(y, m, d, 12, 0, timeZone);
  const [h, mi] = e.time.split(':').map(Number) as [number, number];
  return instantAt(y, m, d, h, mi, timeZone);
}
