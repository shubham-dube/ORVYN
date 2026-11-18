import * as chrono from 'chrono-node';
import { addDays, instantAt, offsetMinutes, wallIn, weekdayOf, ymd } from './time';

/**
 * "dentist fri 11 for 45m", "pay rent every 1st", "kal shaam 6 baje call mom !!" → a task proposal (spec 0002 M2).
 * Rules only: deterministic, offline, no AI. Every recognised piece is reported as a span so the UI can show it as
 * a chip the person can remove — nothing is applied silently.
 */
export type SpanKind = 'date' | 'time' | 'repeat' | 'duration' | 'priority' | 'tag' | 'project';

export interface Span {
  kind: SpanKind;
  text: string;
  start: number;
  end: number;
}

export interface Parsed {
  title: string;
  /** a day without a time */
  dueDate: string | null;
  /** a moment (ISO, UTC) */
  dueAt: string | null;
  durationMin: number | null;
  rrule: string | null;
  priority: number;
  tags: string[];
  projectId: string | null;
  /** an @name that matched no project (the UI can offer to create it) */
  projectName: string | null;
  spans: Span[];
}

export interface ParseOptions {
  now: Date;
  timeZone: string;
  projects?: { id: string; name: string }[];
  /** character ranges the person said to read literally (a removed chip): never parsed, kept in the title */
  literal?: [number, number][];
}

type Hit = { start: number; end: number; kind: SpanKind };

const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const EN_DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  sundays: 0,
  mon: 1,
  monday: 1,
  mondays: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  tuesdays: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  wednesdays: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  thursdays: 4,
  fri: 5,
  friday: 5,
  fridays: 5,
  sat: 6,
  saturday: 6,
  saturdays: 6,
};
const HI_DAYS: Record<string, number> = {
  ravivar: 0,
  ravivaar: 0,
  itwar: 0,
  itvaar: 0,
  somvar: 1,
  somvaar: 1,
  mangalvar: 2,
  mangalvaar: 2,
  mangal: 2,
  budhvar: 3,
  budhvaar: 3,
  budh: 3,
  guruvar: 4,
  guruvaar: 4,
  brihaspativar: 4,
  veervar: 4,
  shukravar: 5,
  shukravaar: 5,
  shukra: 5,
  shanivar: 6,
  shanivaar: 6,
  shani: 6,
};
const ALL_DAYS = { ...EN_DAYS, ...HI_DAYS };
const DAY_RE = Object.keys(ALL_DAYS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
/** parts of the day: default hour, and how a bare "6" is read inside it */
const PARTS: Record<string, { hour: number; pm: boolean | null }> = {
  morning: { hour: 9, pm: false },
  subah: { hour: 9, pm: false },
  subha: { hour: 9, pm: false },
  savere: { hour: 9, pm: false },
  afternoon: { hour: 14, pm: true },
  dopahar: { hour: 14, pm: true },
  dopehar: { hour: 14, pm: true },
  evening: { hour: 18, pm: true },
  shaam: { hour: 18, pm: true },
  sham: { hour: 18, pm: true },
  night: { hour: 21, pm: true },
  raat: { hour: 21, pm: true },
  rat: { hour: 21, pm: true },
};
const PART_RE = Object.keys(PARTS)
  .sort((a, b) => b.length - a.length)
  .join('|');

export function parseTask(input: string, opt: ParseOptions): Parsed {
  const text = input;
  const hits: Hit[] = [];
  const literal = opt.literal ?? [];
  const free = (s: number, e: number) =>
    hits.every((h) => e <= h.start || s >= h.end) && literal.every(([a, b]) => e <= a || s >= b);
  const take = (re: RegExp, kind: SpanKind, fn: (m: RegExpExecArray) => boolean | void) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      const lead = m[1] && /^\s+$/.test(m[1]) ? m[1].length : 0; // patterns may start with a captured boundary
      const start = m.index + lead;
      const end = m.index + m[0].length;
      if (!free(start, end)) continue;
      if (fn(m) === false) continue;
      hits.push({ start, end, kind });
    }
  };
  const B = '(^|\\s)'; // a word boundary that also works before "!" and "#"

  const now = wallIn(opt.now, opt.timeZone);
  const today = ymd(now.y, now.m, now.d);

  let rrule = null as string | null;
  let anchor = null as string | null; // first occurrence from the repeat rule
  let date = null as string | null;
  let hour = null as number | null;
  let bareHour = null as number | null; // a clock number without am/pm
  let minute = 0;
  let durationMin = null as number | null;
  let priority = 0 as number;
  const tags: string[] = [];
  let projectId = null as string | null;
  let projectName = null as string | null;

  const nextWeekday = (wd: number, includeToday = true) => {
    const diff = (wd - now.weekday + 7) % 7;
    return addDays(today, diff === 0 && !includeToday ? 7 : diff);
  };
  const nextMonthDay = (md: number) => {
    const fits = (y: number, m: number) => md <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (md >= now.d && fits(now.y, now.m)) return ymd(now.y, now.m, md);
    let y = now.y;
    let m = now.m;
    for (let i = 0; i < 12; i++) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      if (fits(y, m)) return ymd(y, m, md);
    }
    return null;
  };
  const nextYearDay = (mo: number, d: number) => {
    const thisYear = ymd(now.y, mo, d);
    return thisYear >= today ? thisYear : ymd(now.y + 1, mo, d);
  };
  const dayCodes = (s: string) =>
    [
      ...new Set(
        [...s.toLowerCase().matchAll(new RegExp(`\\b(${DAY_RE})\\b`, 'g'))].map((x) => ALL_DAYS[x[1]!]!),
      ),
    ].sort();

  // ------------------------------------------------------------------ 1. repeats
  const EVERY = '(?:every|each|har)';
  take(new RegExp(`${B}(?:${EVERY}\\s+(?:day|din|roz)|everyday|roz(?:ana)?)\\b`, 'i'), 'repeat', () => {
    rrule = 'FREQ=DAILY';
  });
  take(new RegExp(`${B}(?:${EVERY}\\s+)?weekdays?\\b(?!\\s+(?:${DAY_RE}))`, 'i'), 'repeat', (m) => {
    if (!/every|each|har|weekdays/i.test(m[0])) return false;
    rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  });
  take(new RegExp(`${B}${EVERY}\\s+weekends?\\b`, 'i'), 'repeat', () => {
    rrule = 'FREQ=WEEKLY;BYDAY=SA,SU';
  });
  take(
    new RegExp(`${B}${EVERY}\\s+(\\d+|other|second|alternate)\\s+(days?|weeks?|months?|years?)\\b`, 'i'),
    'repeat',
    (m) => {
      const n = /^\d+$/.test(m[2]!) ? +m[2]! : 2;
      const unit = m[3]!.toLowerCase().replace(/s$/, '');
      rrule = `FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unit]};INTERVAL=${n}`;
    },
  );
  take(
    new RegExp(
      `${B}(?:${EVERY}|on)\\s+(${DAY_RE})(?:(?:\\s*,\\s*|\\s+and\\s+|\\s+aur\\s+|\\s*&\\s*)(${DAY_RE}))*\\b`,
      'i',
    ),
    'repeat',
    (m) => {
      if (
        /^\s*on\s/i.test(m[0]) &&
        !/\b(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i.test(m[0])
      )
        return false;
      const codes = dayCodes(m[0]);
      rrule = `FREQ=WEEKLY;BYDAY=${codes.map((c) => DAYS[c]!.toUpperCase()).join(',')}`;
      anchor = codes.map((c) => nextWeekday(c)).sort()[0]!;
    },
  );
  take(
    new RegExp(
      `${B}${EVERY}\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})|(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`,
      'i',
    ),
    'repeat',
    (m) => {
      const mo = MONTHS[(m[3] ?? m[4])!.toLowerCase()]!;
      const d = +(m[2] ?? m[5])!;
      rrule = `FREQ=YEARLY;BYMONTH=${mo};BYMONTHDAY=${d}`;
      anchor = nextYearDay(mo, d);
    },
  );
  take(
    new RegExp(
      `${B}(?:(?:${EVERY}\\s+(?:month\\s+on\\s+the\\s+)?)|(?:on\\s+the\\s+))(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(?:of\\s+)?(?:the|every|each)?\\s*month)?\\b`,
      'i',
    ),
    'repeat',
    (m) => {
      if (/^\s*on\s+the/i.test(m[0]) && !/month/i.test(m[0])) return false;
      const md = +m[2]!;
      if (md < 1 || md > 31) return false;
      rrule = `FREQ=MONTHLY;BYMONTHDAY=${md}`;
      anchor = nextMonthDay(md);
    },
  );
  take(
    new RegExp(`${B}${EVERY}\\s+(?:last\\s+day\\s+of\\s+(?:the\\s+)?month|month\\s+end|month-end)\\b`, 'i'),
    'repeat',
    () => {
      rrule = 'FREQ=MONTHLY;BYMONTHDAY=-1';
      anchor = ymd(now.y, now.m, new Date(Date.UTC(now.y, now.m, 0)).getUTCDate());
    },
  );
  take(new RegExp(`${B}${EVERY}\\s+(?:week|hafte|hafta)\\b`, 'i'), 'repeat', () => {
    rrule ??= 'FREQ=WEEKLY';
  });
  take(new RegExp(`${B}${EVERY}\\s+(?:month|mahine|mahina)\\b`, 'i'), 'repeat', () => {
    rrule ??= 'FREQ=MONTHLY';
  });
  take(new RegExp(`${B}${EVERY}\\s+(?:year|saal)\\b`, 'i'), 'repeat', () => {
    rrule ??= 'FREQ=YEARLY';
  });
  // a bare "daily / weekly / monthly" repeats only after the name ("backup photos monthly"); as the first word
  // it is part of the name ("Daily standup"), and it never overrides an explicit "every …"
  take(/(^|\s)(daily|weekly|monthly|yearly|annually)\b/i, 'repeat', (m) => {
    if (rrule || text.slice(0, m.index + m[1]!.length).trim() === '') return false;
    rrule = {
      daily: 'FREQ=DAILY',
      weekly: 'FREQ=WEEKLY',
      monthly: 'FREQ=MONTHLY',
      yearly: 'FREQ=YEARLY',
      annually: 'FREQ=YEARLY',
    }[m[2]!.toLowerCase() as 'daily']!;
  });

  // ------------------------------------------------------------------ 2. duration, priority, tags, project
  take(
    /(^|\s)(?:for\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?)|(\d+)h(?:(\d+)m)?|(\d+)\s*(?:m|min|mins)(?![a-z]))(?=$|\s|[,.;!?)])/i,
    'duration',
    (m) => {
      if (m[2]) {
        const v = +m[2];
        durationMin = Math.round(/^h/i.test(m[3]!) ? v * 60 : v);
      } else if (m[4]) durationMin = +m[4] * 60 + (m[5] ? +m[5] : 0);
      else durationMin = +m[6]!;
      if (!durationMin || durationMin > 24 * 60) return false;
    },
  );
  take(
    /(^|\s)(?:for\s+)?(?:half\s+(?:an\s+)?hour|an\s+hour|aadha\s+ghanta|ek\s+ghanta)(?=$|\s|[,.])/i,
    'duration',
    (m) => {
      durationMin = /half|aadha/i.test(m[0]) ? 30 : 60;
    },
  );
  take(/(^|\s)(!{1,3}|p[1-4])(?=$|\s|[,.])/i, 'priority', (m) => {
    const t = m[2]!.toLowerCase();
    priority = t.startsWith('p') ? Math.max(0, 4 - +t[1]!) : t.length;
  });
  take(/(^|\s)(high|medium|low)\s+priority(?=$|\s|[,.])/i, 'priority', (m) => {
    priority = { high: 3, medium: 2, low: 1 }[m[2]!.toLowerCase() as 'high']!;
  });
  take(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/u, 'tag', (m) => {
    tags.push(m[2]!.toLowerCase());
  });
  take(/(^|\s)@([\p{L}\p{N}][\p{L}\p{N}_-]*)/u, 'project', (m) => {
    const name = m[2]!;
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
    const p = opt.projects?.find((x) => norm(x.name) === norm(name));
    if (p) projectId = p.id;
    else projectName = name;
  });

  // ------------------------------------------------------------------ 3. Hinglish and relative days
  /** the first date phrase wins; a later one stays in the title (returns false so it isn't consumed) */
  const setDate = (d: string | null): boolean => {
    if (!d || date) return false;
    date = d;
    return true;
  };
  take(/(^|\s)(aaj|aj|today|tod)\b/i, 'date', () => setDate(today));
  take(/(^|\s)(day\s+after\s+tomorrow|parso|parson)\b/i, 'date', () => setDate(addDays(today, 2)));
  take(/(^|\s)(kal|tomorrow|tmrw|tmr|tomo)\b/i, 'date', () => setDate(addDays(today, 1)));
  take(/(^|\s)(?:next\s+week|agle\s+hafte|agle\s+week)\b/i, 'date', () => setDate(nextWeekday(1, false)));
  take(/(^|\s)(?:this\s+)?weekend\b/i, 'date', () =>
    setDate(now.weekday === 6 || now.weekday === 0 ? today : nextWeekday(6)),
  );
  take(/(^|\s)(?:end\s+of\s+(?:the\s+)?month|eom|month\s+end)\b/i, 'date', () =>
    setDate(ymd(now.y, now.m, new Date(Date.UTC(now.y, now.m, 0)).getUTCDate())),
  );
  take(/(^|\s)(?:next\s+month|agle\s+mahine)\b/i, 'date', () =>
    setDate(now.m === 12 ? ymd(now.y + 1, 1, 1) : ymd(now.y, now.m + 1, 1)),
  );
  take(/(^|\s)in\s+(\d+|a|one|two|three|four|five|six|seven)\s+(days?|weeks?)\b/i, 'date', (m) => {
    const words: Record<string, number> = {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
    };
    const n = words[m[2]!.toLowerCase()] ?? +m[2]!;
    return setDate(addDays(today, /week/i.test(m[3]!) ? n * 7 : n));
  });
  // "next fri", "this monday", bare "friday", Hindi day names (always the coming one)
  take(new RegExp(`${B}(?:(next|this|coming|agle|is)\\s+)?(${DAY_RE})\\b`, 'i'), 'date', (m) => {
    const wd = ALL_DAYS[m[3]!.toLowerCase()]!;
    const q = m[2]?.toLowerCase();
    // "next friday" said on a Monday means this coming Friday in Indian usage; on Friday it means a week later
    return setDate(nextWeekday(wd, q !== 'next' && q !== 'agle'));
  });
  take(/(^|\s)(eod|end\s+of\s+(?:the\s+)?day|by\s+tonight|tonight)\b/i, 'time', (m) => {
    if (hour === null) {
      hour = /eod|end/i.test(m[0]) ? 18 : 21;
      minute = 0;
    }
    setDate(today);
  });
  take(/(^|\s)(noon|midday|dopahar\s+12)\b/i, 'time', () => {
    hour = 12;
    minute = 0;
  });
  take(/(^|\s)midnight\b/i, 'time', () => {
    hour = 23;
    minute = 59;
  });
  // "shaam 6 baje", "subah 7", "6 baje", "raat ko 9:30", "evening 7", "in the evening"
  const weakParts: Hit[] = [];
  let weakHour = null as number | null;
  take(
    new RegExp(
      `${B}(?:(?:in\\s+the\\s+)?(${PART_RE})(?:\\s+ko)?(?:\\s+(?:at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*baje)?)?|(\\d{1,2})(?:[:.](\\d{2}))?\\s*baje(?:\\s+(${PART_RE}))?)\\b`,
      'i',
    ),
    'time',
    (m) => {
      const part = PARTS[(m[2] ?? m[7] ?? '').toLowerCase()];
      const n = m[3] ?? m[5];
      if (n === undefined) {
        // "night shift", "morning pages": only a time if nothing more precise turns up
        if (!part) return false;
        const lead = m[1] && /^\s+$/.test(m[1]) ? m[1].length : 0;
        weakParts.push({ start: m.index + lead, end: m.index + m[0].length, kind: 'time' });
        weakHour ??= part.hour;
        return false;
      }
      let h = +n;
      if (h > 23) return false;
      const pm = part ? part.pm : h >= 1 && h <= 7;
      if (pm && h < 12) h += 12;
      if (part && !part.pm && h === 12) h = 0;
      hour = h;
      minute = +(m[4] ?? m[6] ?? 0);
    },
  );

  // "on 2nd", "on the 25th", "… 18th" at the very end: a day of this or next month
  take(
    /(^|\s)(?:(on\s+(?:the\s+)?)(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th))(?=\s*$|\s+(?:at|by)\b|\s+\d)/i,
    'date',
    (m) => {
      const md = +(m[3] ?? m[4])!;
      if (md < 1 || md > 31 || (!m[2] && !/(st|nd|rd|th)$/i.test(m[0]))) return false;
      return setDate(nextMonthDay(md));
    },
  );
  // "at 6", "at 7:15" — and a bare "11" right after a day word ("fri 11")
  take(
    /(^|\s)at\s+(\d{1,2})(?:[:.](\d{2}))?(?!\s*(?:am|pm|a\.m|p\.m|%|kg|km|rs|inr|\/|[a-z]*\d))(?=\s|$|[,.;])/i,
    'time',
    (m) => {
      const h = +m[2]!;
      if (h > 23 || hour !== null) return false;
      bareHour = h;
      minute = +(m[3] ?? 0);
    },
  );
  for (const h of [...hits].filter((x) => x.kind === 'date')) {
    const after =
      /^\s+(\d{1,2})(?:[:.](\d{2}))?(?=\s|$|[,.;])(?!\s*(?:am|pm|st|nd|rd|th|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov))/i.exec(
        text.slice(h.end),
      );
    if (!after || hour !== null || bareHour !== null || +after[1]! > 23) continue;
    const start = h.end + after[0].length - after[0].trimStart().length;
    const end = h.end + after[0].length;
    if (!free(start, end)) continue;
    bareHour = +after[1]!;
    minute = +(after[2] ?? 0);
    hits.push({ start, end, kind: 'time' });
  }

  // ------------------------------------------------------------------ 4. everything else: chrono (dd/mm first)
  // hide what's already understood; '|' (not spaces) so chrono can't glue a month to the gap
  const masked = [...text]
    .map((c, i) =>
      hits.some((h) => i >= h.start && i < h.end) || literal.some(([a, b]) => i >= a && i < b) ? '|' : c,
    )
    .join('');
  const ref = { instant: opt.now, timezone: offsetMinutes(opt.now, opt.timeZone) };
  for (const r of chrono.en.GB.parse(masked, ref, { forwardDate: true })) {
    const s = r.start;
    const start = r.index;
    const end = r.index + r.text.length;
    if (!free(start, end)) continue;
    // chrono reads lone numbers like "2" in "buy 2 kg rice"; we need a date word, a month, a slash, or am/pm/:
    if (!/[a-z]{3,}|\/|:|\d\s*(?:am|pm)\b|\d(?:st|nd|rd|th)\b/i.test(r.text)) continue;
    const hasTime = s.isCertain('hour');
    const hasDate = s.isCertain('day') || s.isCertain('weekday') || s.isCertain('month');
    if (hasDate && !hasTime && date) continue; // a second date phrase is part of the title
    if (hasDate && !date) {
      const d = s.date(); // instant; take its wall date in the zone
      const w = wallIn(d, opt.timeZone);
      date = ymd(w.y, w.m, w.d);
      // "the 5th" alone, already passed this month → next month (chrono keeps the same month)
      if (!s.isCertain('month') && date < today) date = nextMonthDay(w.d);
      if (!s.isCertain('year') && date && date < today && s.isCertain('month')) date = ymd(w.y + 1, w.m, w.d);
    }
    if (hasTime && hour === null && bareHour === null) {
      if (s.isCertain('meridiem') || s.get('hour')! > 12 || s.get('hour') === 0) hour = s.get('hour')!;
      else bareHour = s.get('hour')!;
      minute = s.get('minute') ?? 0;
    }
    if (!hasTime && !hasDate) continue;
    hits.push({ start, end, kind: hasDate ? 'date' : 'time' });
  }

  // ------------------------------------------------------------------ 5. assemble
  if (!date && anchor) date = anchor;
  if (hour === null && bareHour === null && weakHour !== null) {
    hour = weakHour;
    minute = 0;
    hits.push(...weakParts.slice(0, 1));
  }
  if (bareHour !== null && hour === null) {
    // a clock number without am/pm: 1–7 is afternoon/evening; 12 is noon; 8–11 is the next one to come
    // (at 09:30, "at 9" means 9 pm today, "at 11" means 11 am)
    const b = bareHour;
    if (b >= 13 || b === 0) hour = b;
    else if (b === 12) hour = 12;
    else if (b <= 7) hour = b + 12;
    else {
      const amPassed = (!date || date === today) && b * 60 + minute <= now.h * 60 + now.mi;
      hour = amPassed ? b + 12 : b;
    }
  }
  // the first occurrence of a weekly rule with days: the earliest of those days from today on, skipping today if
  // its time has already passed
  const byday = rrule ? /BYDAY=([A-Z,]+)/.exec(rrule) : null;
  if (rrule && byday && !rrule.includes('INTERVAL')) {
    const want = byday[1]!.split(',').map((c) => DAYS.indexOf(c.toLowerCase()));
    const passedToday = hour !== null && hour * 60 + minute <= now.h * 60 + now.mi;
    for (let i = 0; i < 8; i++) {
      const d = addDays(today, i);
      if (want.includes(weekdayOf(d)) && !(i === 0 && passedToday)) {
        if (!date || date === anchor || date === today) date = d;
        break;
      }
    }
  }
  if (rrule && !anchor && date === null) date = today; // daily/weekly/monthly with no day named: starts today
  if (rrule === 'FREQ=WEEKLY' && date) rrule = `FREQ=WEEKLY;BYDAY=${DAYS[weekdayOf(date)]!.toUpperCase()}`;
  if (rrule === 'FREQ=MONTHLY' && date) rrule = `FREQ=MONTHLY;BYMONTHDAY=${+date.slice(8, 10)}`;
  if (hour !== null && !date) {
    const passed = hour * 60 + minute <= now.h * 60 + now.mi;
    date = passed ? addDays(today, 1) : today;
  } else if (hour !== null && date === today && rrule && hour * 60 + minute <= now.h * 60 + now.mi) {
    // a repeat whose first slot today already passed starts at the next occurrence
    date = rrule.startsWith('FREQ=DAILY') ? addDays(today, 1) : date;
  }

  let dueAt: string | null = null;
  let dueDate: string | null = date;
  if (date && hour !== null) {
    const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
    dueAt = instantAt(y, mo, d, hour, minute, opt.timeZone).toISOString();
    dueDate = null;
  }

  hits.sort((a, b) => a.start - b.start);
  for (const h of hits) {
    if (h.kind !== 'date' && h.kind !== 'time') continue;
    const before = /(^|\s)(on|at|by)\s+$/i.exec(text.slice(0, h.start));
    if (before && free(before.index + before[1]!.length, before.index + before[0].length))
      h.start = before.index + before[1]!.length;
  }
  let title = '';
  let last = 0;
  for (const h of hits) {
    title += text.slice(last, h.start) + ' ';
    last = h.end;
  }
  title += text.slice(last);
  title = cleanTitle(title) || input.trim();

  return {
    title,
    dueDate,
    dueAt,
    durationMin,
    rrule,
    priority,
    tags,
    projectId,
    projectName,
    spans: hits.map((h) => ({
      kind: h.kind,
      start: h.start,
      end: h.end,
      text: text.slice(h.start, h.end).trim(),
    })),
  };
}

const DANGLING = /^(?:on|at|by|for|in|from|to|the|every|each|har|todo:?|task:?)$/i;
/** Hindi particles are part of the phrase at the end ("plants ko"), but dangle at the start ("ko rent") */
const LEADING_ONLY = /^(?:ko|se|tak|ki|ka|ke)$/i;

function cleanTitle(t: string): string {
  let words = t
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+([,.;:!?])/g, '$1')
    .split(' ');
  const strip = (w: string) => w.replace(/^[,.;:\-–—]+|[,.;:\-–—]+$/g, '');
  while (words.length && (DANGLING.test(strip(words.at(-1)!)) || !strip(words.at(-1)!))) words.pop();
  while (
    words.length &&
    (DANGLING.test(strip(words[0]!)) || LEADING_ONLY.test(strip(words[0]!)) || !strip(words[0]!))
  )
    words.shift();
  // "remind me to" spans three words
  const joined = words
    .join(' ')
    .replace(/^remind\s+me\s+to\s+/i, '')
    .replace(/^(?:todo|task)\s*:\s*/i, '');
  words = joined.split(' ');
  const out = words
    .join(' ')
    .replace(/[,;:\-–—]+$/, '')
    .trim();
  // "call mom" → "Call mom", but leave "iPhone", "eBay", "SIP" as typed
  return /^[a-z]+(?=[\s:,.;]|$)/.test(out) ? out[0]!.toUpperCase() + out.slice(1) : out;
}

export { addDays, instantAt, wallIn } from './time';

const UNREAD =
  /\b(\d{1,2}(:\d{2})?\s*(am|pm|baje|bje)|\d{1,2}:\d{2}|\d{1,2}(st|nd|rd|th)|\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|tomorrow|tmrw|tonight|kal|parso|subah|shaam|raat|morning|evening|afternoon|weekend|fortnight|every|har|next|after|before|end of)\b/i;

/**
 * Words that look like a date, time or repeat the rules didn't use (they're still in the title): the only case where
 * asking the AI is worth its cost (spec 0002, M2 fallback).
 */
export function looksUnread(p: Pick<Parsed, 'title' | 'dueDate' | 'dueAt' | 'rrule'>): boolean {
  if (p.dueAt && p.rrule) return false;
  return UNREAD.test(p.title);
}
