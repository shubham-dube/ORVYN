/** Wall-clock helpers for a named time zone (no dependency; Intl only). */
export interface Wall {
  y: number;
  m: number; // 1–12
  d: number;
  h: number;
  mi: number;
  weekday: number; // 0 = Sunday
}

export function wallIn(instant: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    y: +get('year'),
    m: +get('month'),
    d: +get('day'),
    h: +get('hour') % 24,
    mi: +get('minute'),
    weekday: wd,
  };
}

/** Minutes east of UTC for that zone at that instant (IST = 330). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const w = wallIn(instant, timeZone);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/** The instant at a wall-clock time in a zone. */
export function instantAt(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  for (let i = 0; i < 2; i++)
    guess = new Date(Date.UTC(y, m - 1, d, h, mi) - offsetMinutes(guess, timeZone) * 60000);
  return guess;
}

export const ymd = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Calendar arithmetic on a plain date. */
export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
