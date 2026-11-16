'use client';

import {
  type Mutation,
  type Project,
  type PullResponse,
  type PushResult,
  type Task,
  TODAY_PROJECT,
  TODAY_TASK,
} from '@orvyn/contracts';
import { SyncClient } from '@orvyn/sync-client';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { realtime } from './realtime';
import { useToast } from '@/components/ui/bits';
import { useSession } from './session';

interface TodayCtx {
  ready: boolean;
  tasks: Task[];
  projects: Project[];
  pending: number;
  addTask(fields: Partial<Task> & { title: string }): Promise<string>;
  updateTask(id: string, fields: Partial<Task>): Promise<void>;
  removeTask(id: string): Promise<void>;
  addProject(name: string): Promise<string>;
}

const Ctx = createContext<TodayCtx | null>(null);

/** One sync client per signed-in person (database `orvyn-<userId>`), nudged by the live socket. */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { me, deviceId } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pending, setPending] = useState(0);
  const [ready, setReady] = useState(false);
  const toast = useToast();

  const client = useMemo(() => {
    if (!me) return null;
    return new SyncClient(
      `orvyn-${me.id}`,
      {
        push: (mutations: Mutation[]) =>
          api<PushResult>('/sync/push', { method: 'POST', body: { mutations } }),
        pull: (cursor) => api<PullResponse>(`/sync/pull${cursor ? `?cursor=${cursor}` : ''}`),
      },
      `w${(deviceId ?? 'web').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`,
    );
  }, [me, deviceId]);

  const reload = useCallback(async () => {
    if (!client) return;
    const [t, p, n] = await Promise.all([
      client.list<Task>(TODAY_TASK),
      client.list<Project>(TODAY_PROJECT),
      client.pendingCount(),
    ]);
    setTasks(t);
    setProjects(p);
    setPending(n);
    setReady(true);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const off = client.onChange(() => void reload());
    // the server refused a change (e.g. Today was switched off for you): say so, and show the server's truth
    const offRejected = client.onRejected((r) =>
      toast({
        title: 'A change couldn’t be saved',
        body: r.reason === 'forbidden' ? 'Today isn’t enabled for you.' : undefined,
        tone: 'danger',
      }),
    );
    const sync = () => client.sync().catch(() => undefined); // offline: the outbox waits
    void reload().then(sync);
    const offLive = realtime?.on((m) => m.type === 'sync.changed' && void sync());
    window.addEventListener('online', sync);
    const t = setInterval(sync, 60_000);
    return () => {
      off();
      offRejected();
      offLive?.();
      window.removeEventListener('online', sync);
      clearInterval(t);
      client.close();
    };
  }, [client, reload, toast]);

  const value = useMemo<TodayCtx>(() => {
    const write = async <T,>(fn: () => Promise<T>) => {
      const r = await fn();
      void client?.sync().catch(() => undefined);
      return r;
    };
    return {
      ready,
      tasks,
      projects,
      pending,
      addTask: (fields) => write(() => client!.upsert(TODAY_TASK, { ...fields })),
      updateTask: (id, fields) => write(async () => void (await client!.upsert(TODAY_TASK, fields, id))),
      removeTask: (id) => write(() => client!.remove(TODAY_TASK, id)),
      addProject: (name) => write(() => client!.upsert(TODAY_PROJECT, { name })),
    };
  }, [client, ready, tasks, projects, pending]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToday(): TodayCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToday outside TodayProvider');
  return c;
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
