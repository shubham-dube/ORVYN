import { type TimeRange, workingRangesOn, type TodaySettingsFields } from '@orvyn/contracts';
import { instantAt, wallIn } from '@orvyn/today-parse';

/**
 * "Plan my day" (spec 0002 AC6): deterministic, no AI. Events and timed tasks are fixed walls; tasks go only into
 * the person's working hours for that date (D16), with their gap between items, never after their "don't plan
 * after". Each placement says why; anything that doesn't fit says why not. Nothing is applied until accepted.
 */
export interface PlanTask {
  id: string;
  title: string;
  priority: number;
  durationMin: number | null;
  dueDate: string | null;
  dueAt: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
}

export interface Busy {
  title: string;
  start: string;
  end: string;
}

export interface Placement {
  taskId: string;
  title: string;
  start: string;
  end: string;
  reason: string;
}

export interface Plan {
  date: string;
  placed: Placement[];
  unplaced: { taskId: string; title: string; reason: string }[];
  /** working hours used, for the UI to explain */
  hours: TimeRange[];
}

const DEFAULT_MIN = 30;
const STEP = 5 * 60_000;

export function planDay(input: {
  date: string;
  now: Date;
  settings: Pick<TodaySettingsFields, 'patterns' | 'dayOverrides' | 'bufferMin' | 'noPlanAfter' | 'timeZone'>;
  busy: Busy[];
  tasks: PlanTask[];
}): Plan {
  const { date, now, settings: s } = input;
  const tz = s.timeZone;
  const [Y, M, D] = date.split('-').map(Number) as [number, number, number];
  const at = (hhmm: string) => instantAt(Y, M, D, +hhmm.slice(0, 2), +hhmm.slice(3, 5), tz).getTime();
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms);
  const buffer = s.bufferMin * 60_000;
  const hours = workingRangesOn(s, date);
  const cutoff = at(s.noPlanAfter);
  const w = wallIn(now, tz);
  const today = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  const earliest = date === today ? Math.ceil(now.getTime() / STEP) * STEP : -Infinity;

  // fixed walls: events and anything that already has a time today
  const walls: { s: number; e: number; title: string }[] = input.busy.map((b) => ({
    s: Date.parse(b.start),
    e: Date.parse(b.end),
    title: b.title,
  }));
  for (const t of input.tasks) {
    const start = t.scheduledStart ?? t.dueAt;
    if (!start || t.completedAt) continue;
    const st = Date.parse(start);
    walls.push({
      s: st,
      e: st + (t.durationMin ?? (t.scheduledStart ? DEFAULT_MIN : 0)) * 60_000,
      title: t.title,
    });
  }
  walls.sort((a, b) => a.s - b.s);

  // free time = working ranges − (walls ± buffer), not before now (today), not after the cutoff
  let free: { s: number; e: number }[] = hours
    .map((r) => ({ s: Math.max(at(r.start), earliest), e: Math.min(at(r.end), cutoff) }))
    .filter((r) => r.e > r.s);
  for (const wall of walls) {
    const ws = wall.s - buffer;
    const we = wall.e + buffer;
    free = free.flatMap((f) =>
      we <= f.s || ws >= f.e
        ? [f]
        : [
            { s: f.s, e: ws },
            { s: we, e: f.e },
          ].filter((x) => x.e - x.s >= STEP),
    );
  }

  // what to plan: open, untimed, due that day or overdue; most pressing first
  const candidates = input.tasks
    .filter((t) => !t.completedAt && !t.dueAt && !t.scheduledStart && t.dueDate && t.dueDate <= date)
    .sort(
      (a, b) =>
        (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0) ||
        b.priority - a.priority ||
        a.title.localeCompare(b.title),
    );

  const placed: Placement[] = [];
  const unplaced: Plan['unplaced'] = [];
  const nextWall = (ms: number) => walls.find((x) => x.s >= ms);
  for (const t of candidates) {
    const len = (t.durationMin ?? DEFAULT_MIN) * 60_000;
    const slot = free.find((f) => f.e - f.s >= len);
    if (!slot) {
      const longest = free.reduce((m, f) => Math.max(m, f.e - f.s), 0) / 60_000;
      unplaced.push({
        taskId: t.id,
        title: t.title,
        reason:
          hours.length === 0
            ? 'no working hours on this day'
            : `needs ${len / 60_000} min; the longest free stretch left is ${Math.floor(longest)} min`,
      });
      continue;
    }
    const start = slot.s;
    const end = start + len;
    // the slot shrinks: this task plus the gap after it
    slot.s = Math.min(slot.e, end + buffer);
    free = free.filter((f) => f.e - f.s >= STEP);
    const why: string[] = [];
    why.push(
      t.dueDate! < date
        ? `overdue since ${new Date(`${t.dueDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
        : 'due today',
    );
    if (t.priority >= 3) why.push('high priority');
    else if (t.priority === 2) why.push('medium priority');
    why.push(`${len / 60_000} min${t.durationMin ? '' : ' (no length set, so 30)'}`);
    const wall = nextWall(end);
    why.push(
      wall && wall.s - end <= 2 * 3_600_000
        ? `fits before ${wall.title} at ${fmt(wall.s)}`
        : `first free time from ${fmt(start)}`,
    );
    placed.push({
      taskId: t.id,
      title: t.title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      reason: why.join(' · '),
    });
  }
  return { date, placed, unplaced, hours };
}
