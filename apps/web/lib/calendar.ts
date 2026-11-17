import { type Task, type TimeRange } from '@orvyn/contracts';
import { localDay } from './today';

/** Calendar maths for the web views (pure, unit-tested). Everything here is in the browser's local time. */

export const HOUR_PX = 56;
export const SNAP_MIN = 15;

export const atLocal = (day: string, minutes: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
};
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + n));
};
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** A block on the river: minutes from the day's midnight. */
export interface Block {
  key: string;
  kind: 'event' | 'task';
  id: string;
  title: string;
  start: number;
  end: number;
  colour?: string;
  /** set by layout: which column of how many it shares the time with */
  col?: number;
  cols?: number;
}

/** Side-by-side columns for overlapping blocks (each cluster of overlaps shares its width). */
export function layout(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const b of cluster) {
      let col = ends.findIndex((e) => e <= b.start);
      if (col === -1) col = ends.push(b.end) - 1;
      else ends[col] = b.end;
      b.col = col;
    }
    for (const b of cluster) b.cols = ends.length;
    out.push(...cluster);
    cluster = [];
  };
  for (const b of sorted) {
    if (b.start >= clusterEnd && cluster.length) flush();
    cluster.push({ ...b });
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}

/** Free time = working ranges minus busy blocks (and before `from`, e.g. now), at least `min` minutes long. */
export function freeRanges(working: TimeRange[], busy: { start: number; end: number }[], from = 0, min = 15) {
  let free = working
    .map((r) => ({ start: Math.max(toMin(r.start), from), end: toMin(r.end) }))
    .filter((r) => r.end > r.start);
  for (const b of busy) {
    free = free.flatMap((f) =>
      b.end <= f.start || b.start >= f.end
        ? [f]
        : [
            { start: f.start, end: b.start },
            { start: b.end, end: f.end },
          ].filter((x) => x.end > x.start),
    );
  }
  return free.filter((f) => f.end - f.start >= min);
}

/** The minutes a pointer at `y` px (from the top of the river) means, snapped. */
export const snapAt = (y: number) =>
  Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.floor(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN));

/** Monday-first weeks covering a month: 6 rows × 7 days. */
export function monthGrid(day: string): string[] {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const back = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => localDay(new Date(y, m - 1, 1 - back + i)));
}

export function weekOf(day: string): string[] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => localDay(new Date(y, m - 1, d - back + i)));
}

/** Tasks with a time on that day become blocks (a due moment without a length shows as 30 minutes). */
export function taskBlocks(tasks: Task[], day: string): Block[] {
  const out: Block[] = [];
  for (const t of tasks) {
    if (t.completedAt) continue;
    const at = t.scheduledStart ?? t.dueAt;
    if (!at) continue;
    const d = new Date(at);
    if (localDay(d) !== day) continue;
    const start = minutesOf(d);
    out.push({
      key: `t-${t.id}`,
      kind: 'task',
      id: t.id,
      title: t.title,
      start,
      end: Math.min(24 * 60, start + (t.durationMin ?? 30)),
    });
  }
  return out;
}

/** RRULE presets offered for events; anything else shows as "custom". */
export function repeatPresets(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wd = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(y, m - 1, d).getDay()];
  return [
    { value: '', label: 'Doesn’t repeat' },
    { value: 'FREQ=DAILY', label: 'Every day' },
    { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Every weekday' },
    { value: `FREQ=WEEKLY;BYDAY=${wd}`, label: 'Every week' },
    { value: 'FREQ=MONTHLY', label: 'Every month' },
    { value: 'FREQ=YEARLY', label: 'Every year' },
  ];
}
