'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * ClickUp and GitHub in ORVYN (spec 0012 B, G): the shapes the API returns, a tiny stale-while-revalidate cache so
 * nothing pops in late or says "nothing here" before it has looked (B6), and the actions.
 */

export interface HubTask {
  id: string;
  connectionId: string;
  account: string;
  workspace: string;
  teamId: string;
  name: string;
  url: string;
  status: string;
  statusColor: string | null;
  statusType: string;
  working: boolean;
  list: string;
  listId: string;
  folder: string | null;
  due: string | null;
  priority: string | null;
  parentId: string | null;
  trackedMin: number;
  updatedAt: string | null;
  closedAt: string | null;
}

export interface HubStatus {
  name: string;
  color: string | null;
  type: string;
}

export interface Person {
  id: string;
  name: string;
  initials: string;
  color: string | null;
  avatar: string | null;
}

export interface HubDetail {
  task: HubTask & {
    description: string;
    assignees: Person[];
    estimateMin: number | null;
    subtasks: { id: string; name: string; status: string; statusColor: string | null; done: boolean }[];
  };
  statuses: HubStatus[];
  comments: { id: string; text: string; by: Person; at: string; mine: boolean }[];
  time: { id: string; start: string; end: string | null; minutes: number; running: boolean; note: string }[];
}

export interface RunningTimer {
  connectionId: string;
  teamId: string;
  entryId: string | null;
  taskId: string | null;
  taskName: string | null;
  startedAt: string;
}

export interface Pr {
  id: string;
  connectionId: string;
  account: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  review: 'approved' | 'changes' | 'pending' | null;
  checks: 'passing' | 'failing' | 'running' | 'none' | null;
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface GitHubItem {
  id: string;
  connectionId: string;
  account: string;
  kind: 'issue' | 'review';
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
}

const NOT_WORKING =
  /fix|deploy|prod|release|qa|review|test|verif|done|complete|closed|block|hold|cancel|backlog|archiv/i;
const WORKING = /design|develop|progress|doing|working|wip|build|implement|coding|active|ongoing/i;

/** Shown in Today: what the server says, else the same default rule (DESIGN, DEVELOPMENT, IN PROGRESS …). */
export function isWorking(t: Pick<HubTask, 'status' | 'statusType'> & { working?: boolean | null }): boolean {
  if (typeof t.working === 'boolean') return t.working;
  if (t.statusType === 'closed' || t.statusType === 'done' || NOT_WORKING.test(t.status)) return false;
  return WORKING.test(t.status) || t.statusType === 'custom';
}

// ------------------------------------------------------------------ the cache

const store = new Map<string, { at: number; value: unknown }>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();

function read<T>(key: string): T | undefined {
  const m = store.get(key);
  if (m) return m.value as T;
  try {
    const raw = sessionStorage.getItem(`orvyn.cache.${key}`);
    if (raw) {
      const v = JSON.parse(raw) as { at: number; value: T };
      store.set(key, v);
      return v.value;
    }
  } catch {
    /* storage blocked: memory only */
  }
  return undefined;
}

function write(key: string, value: unknown) {
  const v = { at: Date.now(), value };
  store.set(key, v);
  try {
    sessionStorage.setItem(`orvyn.cache.${key}`, JSON.stringify(v));
  } catch {
    /* fine */
  }
  listeners.get(key)?.forEach((f) => f());
}

/** Forget a key (after a change) so the next look asks again; everyone showing it refetches now. */
export function invalidate(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(`orvyn.cache.${prefix}`)) sessionStorage.removeItem(k);
    }
  } catch {
    /* fine */
  }
  for (const [k, ls] of listeners) if (k.startsWith(prefix)) ls.forEach((f) => f());
}

/** Change a cached value in place (an optimistic update). */
export function mutate<T>(key: string, fn: (v: T | undefined) => T) {
  write(key, fn(read<T>(key)));
}

/**
 * Shows the last known value at once, refreshes behind it, and tells apart "loading" from "empty" from "failed".
 * `null` path = not needed (e.g. not connected).
 */
export function useCached<T>(key: string, path: string | null, maxAgeMs = 60_000) {
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const load = useCallback(
    async (fresh = false) => {
      if (!path) return;
      const m = store.get(key);
      if (!fresh && m && Date.now() - m.at < maxAgeMs) return;
      setLoading(true);
      try {
        let p = inflight.get(key);
        if (!p) {
          p = api<T>(path + (fresh ? `${path.includes('?') ? '&' : '?'}fresh=1` : ''));
          inflight.set(key, p);
        }
        write(key, await p);
        if (alive.current) setError(null);
      } catch (e) {
        if (alive.current) setError((e as Error).message || 'failed');
      } finally {
        inflight.delete(key);
        if (alive.current) setLoading(false);
      }
    },
    [key, path, maxAgeMs],
  );
  useEffect(() => {
    alive.current = true;
    const f = () => {
      force((n) => n + 1);
      if (!store.has(key)) void load();
    };
    let ls = listeners.get(key);
    if (!ls) listeners.set(key, (ls = new Set()));
    ls.add(f);
    void load();
    return () => {
      alive.current = false;
      ls.delete(f);
    };
  }, [key, load]);
  const data = path ? read<T>(key) : undefined;
  return {
    data,
    loading: loading && data === undefined,
    refreshing: loading,
    error,
    reload: () => load(true),
  };
}

// ------------------------------------------------------------------ ClickUp actions

const taskPath = (t: { id: string }) => `/connections/clickup/tasks/${encodeURIComponent(t.id)}`;

export async function setClickUpStatus(t: HubTask, status: string) {
  // optimistic: Today moves it at once; on failure the caller says so and it comes back on the refetch
  mutate<HubTask[]>('clickup.open', (xs) => (xs ?? []).map((x) => (x.id === t.id ? { ...x, status } : x)));
  try {
    await api(taskPath(t), { method: 'PATCH', body: { connectionId: t.connectionId, status } });
  } finally {
    invalidate('clickup.');
  }
}

export async function setClickUpPriority(t: HubTask, priority: number | null) {
  await api(taskPath(t), { method: 'PATCH', body: { connectionId: t.connectionId, priority } });
  invalidate('clickup.');
}

export async function setClickUpDue(t: HubTask, day: string | null) {
  await api(`${taskPath(t)}/due`, { method: 'PATCH', body: { connectionId: t.connectionId, dueDate: day } });
  invalidate('clickup.');
}

export async function commentOn(t: HubTask, text: string) {
  await api(`${taskPath(t)}/comments`, { method: 'POST', body: { connectionId: t.connectionId, text } });
  invalidate(`clickup.task.${t.id}`);
}

export async function addTime(t: HubTask, start: Date, minutes: number, note?: string) {
  await api(`${taskPath(t)}/time`, {
    method: 'POST',
    body: {
      connectionId: t.connectionId,
      ...(t.teamId ? { teamId: t.teamId } : {}),
      start: start.toISOString(),
      durationMin: minutes,
      ...(note ? { note } : {}),
    },
  });
  invalidate('clickup.');
}

export async function deleteTime(t: HubTask, entryId: string) {
  const q = new URLSearchParams({ connectionId: t.connectionId, ...(t.teamId ? { teamId: t.teamId } : {}) });
  await api(`/connections/clickup/time/${encodeURIComponent(entryId)}?${q}`, { method: 'DELETE' });
  invalidate('clickup.');
}

export async function startTimer(t: HubTask) {
  await api('/connections/clickup/timer/start', {
    method: 'POST',
    body: { connectionId: t.connectionId, taskId: t.id, ...(t.teamId ? { teamId: t.teamId } : {}) },
  });
  invalidate('clickup.timer');
}

export async function stopTimer(r: RunningTimer): Promise<number | null> {
  const res = await api<{ minutes?: number }>('/connections/clickup/timer/stop', {
    method: 'POST',
    body: { connectionId: r.connectionId, ...(r.teamId ? { teamId: r.teamId } : {}) },
  });
  invalidate('clickup.');
  return res.minutes ?? null;
}

// ------------------------------------------------------------------ words

/** "3h 20m" */
export const hm = (min: number) =>
  min < 60 ? `${min}m` : min % 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${Math.floor(min / 60)}h`;

/** "1:02:09" */
export const clockOf = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** "Today", "Tomorrow", "Fri", "Fri 20 Nov" for a YYYY-MM-DD */
export function dayWords(day: string, now = new Date()): string {
  const d = new Date(`${day}T12:00:00`);
  const n = Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000,
  );
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** "past", "near" (within 2 days) or null for a deadline. */
export function deadlineTone(deadline: string | null | undefined, now = new Date()): 'past' | 'near' | null {
  if (!deadline) return null;
  const d = new Date(`${deadline}T12:00:00`);
  const n = Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000,
  );
  return n < 0 ? 'past' : n <= 2 ? 'near' : null;
}

/** A link to join a call, in an event's place or notes. */
export function joinLink(place: string, notes: string): string | null {
  return (
    /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com|[\w.-]*webex\.com)\/[^\s<>")]+/.exec(
      `${place}\n${notes}`,
    )?.[0] ?? null
  );
}

export function prSummary(prs: Pr[]): string {
  const open = prs.filter((p) => p.state === 'open');
  const approved = open.filter((p) => p.review === 'approved').length;
  const changes = open.filter((p) => p.review === 'changes').length;
  const failing = open.filter((p) => p.checks === 'failing').length;
  return [
    `${open.length} open`,
    approved ? `${approved} approved` : null,
    changes ? `${changes} need changes` : null,
    failing ? `${failing} failing checks` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
