import type { Task } from '@orvyn/contracts';
import { type Parsed, parseTask, type Span } from '@orvyn/today-parse';

/** Parse with the person's zone and projects; `literal` = chips they removed. */
export function smartParse(
  text: string,
  opts: { timeZone?: string; projects: { id: string; name: string }[]; literal: [number, number][] },
): Parsed {
  return parseTask(text, {
    now: new Date(),
    timeZone: opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    projects: opts.projects,
    literal: opts.literal,
  });
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function repeatLabel(rrule: string): string {
  const get = (k: string) => new RegExp(`${k}=([^;]+)`).exec(rrule)?.[1];
  const freq = get('FREQ');
  const n = Number(get('INTERVAL') ?? 1);
  const every = (unit: string) => (n > 1 ? `every ${n} ${unit}s` : `every ${unit}`);
  const byday = get('BYDAY');
  if (byday === 'MO,TU,WE,TH,FR') return 'every weekday';
  if (byday === 'SA,SU') return 'every weekend';
  if (byday)
    return `every ${byday
      .split(',')
      .map((d) => DAY_NAMES[['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d)])
      .join(', ')}`;
  const md = get('BYMONTHDAY');
  if (freq === 'MONTHLY' && md)
    return md === '-1' ? 'last day of every month' : `every month on the ${ordinal(+md)}`;
  if (freq === 'YEARLY' && get('BYMONTH'))
    return `every year on ${new Date(2000, +get('BYMONTH')! - 1, +md!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  return every({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq ?? 'DAILY'] ?? 'day');
}

const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`;

/** What a chip says: the meaning, not the words typed. */
export function chipLabel(span: Span, p: Parsed, projects: { id: string; name: string }[]): string {
  switch (span.kind) {
    case 'date': {
      const d = p.dueAt ? new Date(p.dueAt) : p.dueDate ? new Date(`${p.dueDate}T00:00`) : null;
      return d
        ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
        : span.text;
    }
    case 'time':
      return p.dueAt
        ? new Date(p.dueAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : span.text;
    case 'repeat':
      return p.rrule ? repeatLabel(p.rrule) : span.text;
    case 'duration': {
      const m = p.durationMin ?? 0;
      return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
    }
    case 'priority':
      return ['No priority', 'Low', 'Medium', 'High'][p.priority] ?? span.text;
    case 'tag':
      return span.text;
    case 'project':
      return p.projectId
        ? (projects.find((x) => x.id === p.projectId)?.name ?? span.text)
        : `${span.text.slice(1)} (new project)`;
  }
}

/** Fields for a new task from a parse (the server fills the rest). */
export function taskFields(p: Parsed, fallbackDay: string | null): Partial<Task> & { title: string } {
  const timed = !!p.dueAt;
  return {
    title: p.title,
    dueAt: p.dueAt,
    dueDate: timed ? null : (p.dueDate ?? fallbackDay),
    durationMin: p.durationMin,
    rrule: p.rrule,
    priority: p.priority,
    tags: p.tags,
    projectId: p.projectId,
  };
}
