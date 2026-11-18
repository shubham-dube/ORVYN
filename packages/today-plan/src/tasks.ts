import { wallIn } from '@orvyn/today-parse';

/** What a task query needs from a task (the full task has more). */
export interface TaskLike {
  title: string;
  notes?: string;
  tags: string[];
  projectId: string | null;
  priority: number;
  dueDate: string | null;
  dueAt: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  checklist: { text: string; done: boolean }[];
}

export const WHEN = ['any', 'overdue', 'today', 'week', 'later', 'none'] as const;
export type When = (typeof WHEN)[number];

/**
 * A search and filter over tasks: words, a project ('none' = no project), a tag, a minimum priority and when it is due.
 * Saved filters are just a named query. Same rules in Dart (apps/mobile/lib/app/task_query.dart), same fixtures.
 */
export interface TaskQuery {
  text: string;
  projectId: string | null;
  tag: string | null;
  minPriority: number;
  when: When;
}

export const EMPTY_QUERY: TaskQuery = { text: '', projectId: null, tag: null, minPriority: 0, when: 'any' };

export const isEmptyQuery = (q: TaskQuery) =>
  !q.text.trim() && q.projectId === null && q.tag === null && q.minPriority === 0 && q.when === 'any';

const ymd = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The day a task belongs to in a zone: its time block, else its due moment, else its due date; null = no day. */
export function taskDayIn(t: TaskLike, timeZone: string): string | null {
  const at = t.scheduledStart ?? t.dueAt;
  if (at) {
    const w = wallIn(new Date(at), timeZone);
    return ymd(w.y, w.m, w.d);
  }
  return t.dueDate;
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function taskMatches(t: TaskLike, q: TaskQuery, now: Date, timeZone: string): boolean {
  if (q.projectId !== null && (q.projectId === 'none' ? t.projectId !== null : t.projectId !== q.projectId))
    return false;
  if (q.tag !== null && !t.tags.some((x) => x.toLowerCase() === q.tag!.toLowerCase())) return false;
  if (t.priority < q.minPriority) return false;
  if (q.when !== 'any') {
    const w = wallIn(now, timeZone);
    const today = ymd(w.y, w.m, w.d);
    const day = taskDayIn(t, timeZone);
    const ok =
      q.when === 'none'
        ? day === null
        : day === null
          ? false
          : q.when === 'overdue'
            ? day < today
            : q.when === 'today'
              ? day === today
              : q.when === 'week'
                ? day >= today && day <= addDays(today, 6)
                : day > addDays(today, 6);
    if (!ok) return false;
  }
  const words = q.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [t.title, t.notes ?? '', ...t.tags, ...t.checklist.map((c) => c.text)].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function checklistProgress(t: Pick<TaskLike, 'checklist'>): { done: number; total: number } {
  return { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length };
}

/** Every tag in use, most used first. */
export function allTags(tasks: Pick<TaskLike, 'tags'>[]): string[] {
  const n = new Map<string, { label: string; count: number }>();
  for (const t of tasks)
    for (const tag of t.tags) {
      const k = tag.toLowerCase();
      const e = n.get(k);
      if (e) e.count++;
      else n.set(k, { label: tag, count: 1 });
    }
  return [...n.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((e) => e.label);
}

/** A short line for a query ("work · #urgent · high priority · this week"), shown on saved filters. */
export function describeQuery(q: TaskQuery, projectName?: (id: string) => string | undefined): string {
  const bits: string[] = [];
  if (q.text.trim()) bits.push(`“${q.text.trim()}”`);
  if (q.projectId === 'none') bits.push('no project');
  else if (q.projectId) bits.push(projectName?.(q.projectId) ?? 'project');
  if (q.tag) bits.push(`#${q.tag}`);
  if (q.minPriority) bits.push(['', 'low+', 'medium+', 'high'][q.minPriority] + ' priority');
  if (q.when !== 'any')
    bits.push(
      {
        overdue: 'overdue',
        today: 'today',
        week: 'next 7 days',
        later: 'later',
        none: 'no date',
      }[q.when],
    );
  return bits.join(' · ') || 'Everything';
}
