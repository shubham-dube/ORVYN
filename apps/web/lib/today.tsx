'use client';

import {
  type CalEvent,
  EVENT_DEFAULTS,
  type Calendar,
  type Project,
  type SavedFilter,
  type Task,
  TODAY_CALENDAR,
  TODAY_EVENT,
  TODAY_FILTER,
  TODAY_PROJECT,
  TODAY_SETTINGS,
  TODAY_TASK,
  TaskFields,
  type TodaySettingsFields,
} from '@orvyn/contracts';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from './session';
import { useSync } from './sync';

interface TodayCtx {
  ready: boolean;
  tasks: Task[];
  projects: Project[];
  pending: number;
  /** null until the person has saved their own (D16, D17) */
  settings: TodaySettingsFields | null;
  saveSettings(fields: Partial<TodaySettingsFields>): Promise<void>;
  addTask(fields: Partial<Task> & { title: string }): Promise<string>;
  updateTask(id: string, fields: Partial<Task>): Promise<void>;
  removeTask(id: string): Promise<void>;
  addProject(name: string, colour?: Project['colour']): Promise<string>;
  updateProject(id: string, fields: Partial<Project>): Promise<void>;
  filters: SavedFilter[];
  saveFilter(id: string | null, fields: Partial<SavedFilter>): Promise<string>;
  removeFilter(id: string): Promise<void>;
  events: CalEvent[];
  calendars: Calendar[];
  addEvent(fields: Partial<CalEvent> & { title: string }): Promise<string>;
  updateEvent(id: string, fields: Partial<CalEvent>): Promise<void>;
  removeEvent(id: string): Promise<void>;
  saveCalendar(id: string | null, fields: Partial<Calendar>): Promise<string>;
}

const Ctx = createContext<TodayCtx | null>(null);

/** Defaults for fields a task written offline (or by an older device) doesn't carry yet. */
const TASK_DEFAULTS = TaskFields.omit({ title: true }).parse({});

/** Today's data from the shared offline mirror (lib/sync.tsx). */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { client, version, pending, write } = useSync();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [settings, setSettings] = useState<TodaySettingsFields | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [t, p, st, ev, cal, fl] = await Promise.all([
      client.list<Task>(TODAY_TASK),
      client.list<Project>(TODAY_PROJECT),
      me ? client.get<TodaySettingsFields>(TODAY_SETTINGS, me.id) : null,
      client.list<CalEvent>(TODAY_EVENT),
      client.list<Calendar>(TODAY_CALENDAR),
      client.list<SavedFilter>(TODAY_FILTER),
    ]);
    setFilters([...fl].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    setEvents(ev.map((e) => ({ ...EVENT_DEFAULTS, ...e })));
    setCalendars(cal);
    setSettings(st);
    setTasks(t.map((x) => ({ ...TASK_DEFAULTS, ...x })));
    setProjects(p);
    setReady(true);
  }, [client, me]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  const value = useMemo<TodayCtx>(() => {
    return {
      ready,
      tasks,
      projects,
      pending,
      settings,
      saveSettings: (fields) => write(async () => void (await client.upsert(TODAY_SETTINGS, fields, me!.id))),
      addTask: (fields) => write(() => client.upsert(TODAY_TASK, { ...fields })),
      updateTask: (id, fields) => write(async () => void (await client.upsert(TODAY_TASK, fields, id))),
      removeTask: (id) => write(() => client.remove(TODAY_TASK, id)),
      addProject: (name, colour) =>
        write(() => client.upsert(TODAY_PROJECT, { name, ...(colour ? { colour } : {}) })),
      updateProject: (id, fields) => write(async () => void (await client.upsert(TODAY_PROJECT, fields, id))),
      filters,
      saveFilter: (id, fields) =>
        write(async () =>
          id ? (await client.upsert(TODAY_FILTER, fields, id), id) : client.upsert(TODAY_FILTER, fields),
        ),
      removeFilter: (id) => write(() => client.remove(TODAY_FILTER, id)),
      events,
      calendars,
      addEvent: (fields) => write(() => client.upsert(TODAY_EVENT, { ...fields })),
      updateEvent: (id, fields) => write(async () => void (await client.upsert(TODAY_EVENT, fields, id))),
      removeEvent: (id) => write(() => client.remove(TODAY_EVENT, id)),
      saveCalendar: (id, fields) =>
        write(async () =>
          id ? (await client.upsert(TODAY_CALENDAR, fields, id), id) : client.upsert(TODAY_CALENDAR, fields),
        ),
    };
  }, [write, client, me, ready, tasks, projects, filters, pending, settings, events, calendars]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToday(): TodayCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToday outside TodayProvider');
  return c;
}

/** For places that only sometimes have Today (the command bar): null when it isn't switched on. */
export function useTodayMaybe(): TodayCtx | null {
  return useContext(Ctx);
}

// ------------------------------------------------------------------ grouping (pure, tested)

export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day a task belongs to: its time block, else its due moment, else its due date; null = Inbox. */
export function taskDay(t: Task): string | null {
  if (t.scheduledStart) return localDay(new Date(t.scheduledStart));
  if (t.dueAt) return localDay(new Date(t.dueAt));
  return t.dueDate ?? null;
}

export function taskMoment(t: Task): number | null {
  const s = t.scheduledStart ?? t.dueAt;
  return s ? new Date(s).getTime() : null;
}

export interface Groups {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  inbox: Task[];
  doneToday: Task[];
}

export function groupTasks(tasks: Task[], now: Date): Groups {
  const today = localDay(now);
  const g: Groups = { overdue: [], today: [], upcoming: [], inbox: [], doneToday: [] };
  for (const t of tasks) {
    if (t.completedAt) {
      if (localDay(new Date(t.completedAt)) === today) g.doneToday.push(t);
      continue;
    }
    const day = taskDay(t);
    if (!day) g.inbox.push(t);
    else if (day < today) g.overdue.push(t);
    else if (day === today) g.today.push(t);
    else g.upcoming.push(t);
  }
  const byTime = (a: Task, b: Task) =>
    (taskMoment(a) ?? Infinity) - (taskMoment(b) ?? Infinity) ||
    b.priority - a.priority ||
    a.title.localeCompare(b.title);
  g.overdue.sort(byTime);
  g.today.sort(byTime);
  g.upcoming.sort((a, b) => (taskDay(a) ?? '').localeCompare(taskDay(b) ?? '') || byTime(a, b));
  g.inbox.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
  g.doneToday.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return g;
}
