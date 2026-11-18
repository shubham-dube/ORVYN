import { wallIn } from '@orvyn/today-parse';
import type { Instance } from './events';
import { type TaskLike, taskDayIn } from './tasks';

/** One thing in "what's next": an event or a task with a time, in order. */
export interface NextItem {
  kind: 'event' | 'task';
  id: string;
  title: string;
  /** instant (ms) it starts, or null for an all-day event / a task with only a day */
  at: number | null;
  /** an end instant for events */
  until: number | null;
  allDay: boolean;
}

export interface DayShape {
  /** open tasks due today (including overdue ones, which are "still on your plate") */
  open: number;
  /** tasks finished today */
  doneToday: number;
  overdue: number;
  /** 0–1 share of today's tasks that are done (1 when there were none) */
  progress: number;
  /** what's next, in time order: not yet finished events and timed or all-day things for the rest of today */
  next: NextItem[];
  /** free-form line: "3 left · next: Standup at 10:00" */
  line: string;
}

type DashTask = TaskLike & { id: string };

/**
 * The shape of a person's day for the dashboard, from local data only. Same rules as Today's sections: a task belongs
 * to its time block, else its due moment, else its due date; a repeating task that was ticked has already moved on.
 */
export function dayShape(
  tasks: DashTask[],
  events: Instance[],
  now: Date,
  timeZone: string,
  hhmm: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }),
): DayShape {
  const w = wallIn(now, timeZone);
  const today = `${String(w.y).padStart(4, '0')}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
  let open = 0;
  let doneToday = 0;
  let overdue = 0;
  const next: NextItem[] = [];
  for (const t of tasks) {
    if (t.completedAt) {
      const c = wallIn(new Date(t.completedAt), timeZone);
      if (
        `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}` ===
        today
      )
        doneToday++;
      continue;
    }
    const day = taskDayIn(t, timeZone);
    if (!day) continue;
    if (day < today) {
      overdue++;
      open++;
    } else if (day === today) {
      open++;
      const at = t.scheduledStart ?? t.dueAt;
      const ms = at ? Date.parse(at) : null;
      if (ms === null || ms >= now.getTime())
        next.push({ kind: 'task', id: t.id, title: t.title, at: ms, until: null, allDay: false });
    }
  }
  for (const e of events) {
    if (e.allDay) {
      if (e.startDate! <= today && e.endDate! > today)
        next.push({ kind: 'event', id: e.eventId, title: e.title, at: null, until: null, allDay: true });
    } else {
      const s = Date.parse(e.start!);
      const end = Date.parse(e.end!);
      if (end > now.getTime() && wallDay(s, timeZone) === today)
        next.push({
          kind: 'event',
          id: e.eventId + (e.occurrence ?? ''),
          title: e.title,
          at: s,
          until: end,
          allDay: false,
        });
    }
  }
  // all-day things first, then by time, with timeless tasks last
  next.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      (a.at ?? Infinity) - (b.at ?? Infinity) ||
      a.title.localeCompare(b.title),
  );
  const total = open + doneToday;
  const first = next.find((n) => n.at !== null);
  const bits: string[] = [];
  if (open) bits.push(`${open} to do`);
  else if (doneToday) bits.push('all done');
  else bits.push('a clear day');
  if (first) bits.push(`next: ${first.title} at ${hhmm(first.at!)}`);
  return { open, doneToday, overdue, progress: total ? doneToday / total : 1, next, line: bits.join(' · ') };
}

const wallDay = (ms: number, timeZone: string) => {
  const w = wallIn(new Date(ms), timeZone);
  return `${String(w.y).padStart(4, '0')}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
};

/** Open tasks due on each of the next `days` days (starting today), for the week-ahead bars. */
export function weekAhead(
  tasks: TaskLike[],
  now: Date,
  timeZone: string,
  days = 7,
): { date: string; count: number }[] {
  const w = wallIn(now, timeZone);
  const start = Date.UTC(w.y, w.m - 1, w.d);
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i++)
    out.push({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), count: 0 });
  const idx = new Map(out.map((d, i) => [d.date, i]));
  for (const t of tasks) {
    if (t.completedAt) continue;
    const d = taskDayIn(t, timeZone);
    const i = d ? idx.get(d) : undefined;
    if (i !== undefined) out[i]!.count++;
  }
  return out;
}
