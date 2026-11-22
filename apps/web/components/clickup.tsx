'use client';

import {
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock,
  ExternalLink,
  Flag,
  Hammer,
  LayoutList,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  Timer,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Glass, Label, Segmented, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { localDay } from '@/lib/today';
import {
  addTime,
  clockOf,
  commentOn,
  dayWords,
  deleteTime,
  hm,
  type HubDetail,
  type HubStatus,
  type HubTask,
  invalidate,
  isWorking,
  type RunningTimer,
  setClickUpDue,
  setClickUpPriority,
  setClickUpStatus,
  startTimer,
  stopTimer,
  useCached,
} from '@/lib/work';
import { type Connection, ProviderMark } from './connections';
import { FactPill, usePick } from './pick';

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const colour = (c: string | null | undefined) => c || 'var(--orv-faint)';
const PRIO: Record<string, string> = {
  urgent: 'var(--orv-danger)',
  high: 'var(--orv-warning)',
  normal: 'var(--orv-accent)',
  low: 'var(--orv-faint)',
};

// ------------------------------------------------------------------ data hooks

export function useConnectionsCached() {
  return useCached<Connection[]>('connections', '/connections', 5 * 60_000);
}

export function useClickUp() {
  const conns = useConnectionsCached();
  const has = !!conns.data?.some((c) => c.provider === 'clickup');
  const tasks = useCached<HubTask[]>('clickup.open', has ? '/connections/clickup/tasks' : null, 60_000);
  return { has, known: conns.data !== undefined, ...tasks };
}

export function useTimer() {
  const conns = useConnectionsCached();
  const has = !!conns.data?.some((c) => c.provider === 'clickup');
  const t = useCached<{ timer: RunningTimer | null }>(
    'clickup.timer',
    has ? '/connections/clickup/timer' : null,
    30_000,
  );
  useEffect(() => {
    if (!has) return;
    const i = setInterval(() => invalidate('clickup.timer'), 60_000); // a timer started in ClickUp shows up
    return () => clearInterval(i);
  }, [has]);
  return t.data?.timer ?? null;
}

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [on]);
}

// ------------------------------------------------------------------ one ClickUp row

export function ClickUpRow({
  task,
  onOpen,
  showStatus = true,
  timing,
  onStatus,
}: {
  task: HubTask;
  onOpen(t: HubTask): void;
  showStatus?: boolean;
  timing?: boolean;
  onStatus(t: HubTask): void;
}) {
  const now = new Date();
  const due = task.due ? new Date(task.due) : null;
  const late = !!due && localDay(due) < localDay(now);
  return (
    <li className="group flex items-center gap-3 rounded-orv-md px-1 py-2 hover:bg-orv-track">
      <button
        type="button"
        aria-label={`Status ${task.status}. Change`}
        onClick={() => onStatus(task)}
        className="grid size-6 shrink-0 place-items-center rounded-full border-[2.2px] transition-transform hover:scale-110"
        style={{ borderColor: colour(task.statusColor) }}
      >
        <span className="size-2 rounded-full" style={{ background: colour(task.statusColor) }} />
      </button>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="line-clamp-2 text-[15px] font-medium">{task.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-orv-muted">
          {showStatus ? (
            <span
              className="rounded-full px-1.5 py-px text-[10px] font-extrabold uppercase tracking-wide"
              style={{
                background: `color-mix(in srgb, ${colour(task.statusColor)} 16%, transparent)`,
                color: colour(task.statusColor),
              }}
            >
              {task.status}
            </span>
          ) : null}
          <span>{task.list}</span>
          {due ? (
            <span className={cn('inline-flex items-center gap-1', late && 'text-orv-danger')}>
              <CalendarDays size={11} aria-hidden /> {dayWords(localDay(due), now)}
            </span>
          ) : null}
          {task.trackedMin ? (
            <span className="inline-flex items-center gap-1">
              <Timer size={11} aria-hidden /> {hm(task.trackedMin)}
            </span>
          ) : null}
        </span>
      </button>
      {timing ? (
        <span aria-label="Timer running" className="size-2 animate-pulse rounded-full bg-orv-danger" />
      ) : null}
      {task.priority && task.priority !== 'low' ? (
        <Flag size={14} style={{ color: PRIO[task.priority] }} aria-label={`${task.priority} priority`} />
      ) : null}
    </li>
  );
}

/** Status picking and the task sheet, shared by Today and the ClickUp page. */
export function useClickUpActions() {
  const toast = useToast();
  const { ask, picker } = usePick();
  const [open, setOpen] = useState<HubTask | null>(null);
  const pickStatus = async (t: HubTask, statuses?: HubStatus[]) => {
    let list = statuses;
    if (!list) {
      try {
        const { api } = await import('@/lib/api');
        list = (
          await api<HubDetail>(
            `/connections/clickup/tasks/${encodeURIComponent(t.id)}?connectionId=${t.connectionId}`,
          )
        ).statuses;
      } catch {
        list = [];
      }
    }
    if (!list.length) return;
    const v = await ask<string>(
      'Move to',
      list.map((s) => ({
        value: s.name,
        label: cap(s.name),
        colour: colour(s.color),
        sub: s.type === 'closed' || s.type === 'done' ? 'Done' : undefined,
        selected: s.name.toLowerCase() === t.status.toLowerCase(),
      })),
    );
    if (!v || v.toLowerCase() === t.status.toLowerCase()) return;
    try {
      await setClickUpStatus(t, v);
      toast({ title: `Moved to ${v}`, body: t.name, tone: 'success' });
    } catch {
      toast({ title: 'ClickUp didn’t take it', tone: 'danger' });
    }
  };
  const ui = (
    <>
      {picker}
      <ClickUpTaskSheet task={open} onClose={() => setOpen(null)} onStatus={pickStatus} />
    </>
  );
  return { pickStatus, openTask: setOpen, ui };
}

// ------------------------------------------------------------------ the running timer

export function TimerPill() {
  const t = useTimer();
  const toast = useToast();
  useTick(!!t);
  if (!t) return null;
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--orv-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--orv-danger)_12%,transparent)] pl-3 pr-1">
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-orv-danger" />
      <span className="tabular font-mono text-[13px] font-bold">
        {clockOf(Date.now() - Date.parse(t.startedAt))}
      </span>
      <span className="max-w-48 truncate text-[12.5px] text-orv-muted">{t.taskName}</span>
      <button
        type="button"
        aria-label="Stop the timer"
        onClick={async () => {
          try {
            const m = await stopTimer(t);
            toast({
              title: m ? `Logged ${hm(m)}` : 'Timer stopped',
              body: t.taskName ?? undefined,
              tone: 'success',
            });
          } catch {
            toast({ title: 'Couldn’t stop it', tone: 'danger' });
          }
        }}
        className="grid size-6 place-items-center rounded-full text-orv-danger hover:bg-orv-track"
      >
        <Square size={12} fill="currentColor" />
      </button>
    </span>
  );
}

// ------------------------------------------------------------------ Working on (Today)

/** Only the statuses I'm working in, with the rest one tap away; never "nothing" before ClickUp answered. */
export function WorkingOn() {
  const { has, data, loading, refreshing, error, reload } = useClickUp();
  const timer = useTimer();
  const { pickStatus, openTask, ui } = useClickUpActions();
  const [settings, setSettings] = useState(false);
  if (!has) return null;
  const working = (data ?? []).filter((t) => isWorking(t));
  const others = (data?.length ?? 0) - working.length;
  return (
    <Glass as="section" className="p-4">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Hammer size={14} className="text-orv-accent" aria-hidden />
        <Label>Working on</Label>
        {working.length ? <span className="text-[12px] text-orv-muted">{working.length}</span> : null}
        <span className="flex-1" />
        {refreshing && data ? (
          <span
            aria-label="Refreshing"
            className="size-3 animate-spin rounded-full border-2 border-orv-faint border-t-transparent"
          />
        ) : null}
        <button
          type="button"
          aria-label="Which statuses show here"
          onClick={() => setSettings(true)}
          className="grid size-7 place-items-center rounded-full text-orv-muted hover:bg-orv-track"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      {data === undefined && error ? (
        <div className="flex items-center gap-2 px-1 py-2 text-small text-orv-muted">
          ClickUp didn’t answer.
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : data === undefined || loading ? (
        <SkeletonRows rows={2} label="Loading ClickUp" />
      ) : (
        <ul className="flex flex-col">
          {working.length === 0 ? (
            <li className="px-1 py-2 text-small text-orv-muted">
              {data.length
                ? 'Nothing in design or development right now.'
                : 'Nothing open is assigned to you in ClickUp.'}
            </li>
          ) : null}
          {working.map((t) => (
            <ClickUpRow
              key={t.id}
              task={t}
              onOpen={openTask}
              onStatus={(x) => void pickStatus(x)}
              timing={timer?.taskId === t.id}
            />
          ))}
        </ul>
      )}
      <Link
        href="/today/clickup"
        className="mt-1 flex items-center gap-2 rounded-orv-sm px-1 py-1.5 text-small font-semibold text-orv-accent hover:bg-orv-track"
      >
        <ProviderMark id="clickup" size={16} />
        <span className="flex-1">
          {data === undefined
            ? 'All of ClickUp'
            : others > 0
              ? `${others} more in other statuses`
              : 'All statuses, done and closed'}
        </span>
        <ChevronRight size={15} aria-hidden />
      </Link>
      {ui}
      <ClickUpStatusesSheet open={settings} onClose={() => setSettings(false)} />
    </Glass>
  );
}

// ------------------------------------------------------------------ the ClickUp page

export function ClickUpView() {
  const { has, known, data, loading, error, reload } = useClickUp();
  const timer = useTimer();
  const [showClosed, setShowClosed] = useState(false);
  const closedData = useCached<HubTask[]>(
    'clickup.closed',
    showClosed ? '/connections/clickup/tasks?closed=1' : null,
    5 * 60_000,
  );
  const { pickStatus, openTask, ui } = useClickUpActions();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const [list, setList] = useState<string | null>(null);
  const [flip, setFlip] = useState<string[]>([]);
  const all = useMemo(() => data ?? [], [data]);
  const lists = useMemo(() => [...new Set(all.map((t) => t.list))].sort(), [all]);
  const shown = all.filter(
    (t) => (!list || t.list === list) && (!q || t.name.toLowerCase().includes(q.toLowerCase())),
  );
  const order: string[] = [];
  const groups = new Map<string, HubTask[]>();
  for (const t of [...shown.filter((t) => isWorking(t)), ...shown.filter((t) => !isWorking(t))]) {
    if (!groups.has(t.status)) order.push(t.status);
    const g = groups.get(t.status);
    if (g) g.push(t);
    else groups.set(t.status, [t]);
  }
  const folded = (k: string) => {
    const working = isWorking(groups.get(k)![0]!);
    return working ? flip.includes(k) : !flip.includes(k);
  };

  if (known && !has)
    return (
      <Glass className="p-6 text-center text-small text-orv-muted">
        ClickUp isn’t connected. Connect it in Settings → Connections.
      </Glass>
    );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div className="flex items-center gap-3">
          <ProviderMark id="clickup" size={32} />
          <div>
            <span className="text-small text-orv-muted">
              {data ? `${all.filter((t) => isWorking(t)).length} working · ${all.length} open` : 'ClickUp'}
            </span>
            <h1 className="text-title font-semibold">ClickUp</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TimerPill />
          <Segmented<'list' | 'board'>
            label="ClickUp view"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'List' },
              { value: 'board', label: 'Board' },
            ]}
          />
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="field-ring flex h-10 min-w-56 flex-1 items-center gap-2 rounded-full px-3">
          <Search size={15} className="text-orv-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your ClickUp tasks"
            aria-label="Search ClickUp tasks"
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-orv-faint"
          />
        </label>
        {lists.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lists">
            {[null, ...lists].map((x) => (
              <FactPill
                key={x ?? '*'}
                icon={<LayoutList size={13} />}
                label={x ?? 'All lists'}
                set={list === x}
                onClick={() => setList(x)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {data === undefined && error ? (
        <Glass className="flex items-center gap-3 p-4 text-small">
          ClickUp didn’t answer.
          <Button size="sm" onClick={() => void reload()}>
            Try again
          </Button>
        </Glass>
      ) : data === undefined || loading ? (
        <SkeletonRows rows={5} label="Loading ClickUp" />
      ) : all.length === 0 ? (
        <Glass className="p-5 text-small text-orv-muted">Nothing open is assigned to you.</Glass>
      ) : view === 'board' ? (
        <div className="flex snap-x gap-3 overflow-x-auto pb-3">
          {order.map((k) => {
            const items = groups.get(k)!;
            return (
              <Glass
                key={k}
                as="section"
                aria-label={`${k}, ${items.length} tasks`}
                className="flex w-72 shrink-0 snap-start flex-col p-3"
              >
                <div className="mb-2 flex items-center gap-2 px-1" onDragOver={(e) => e.preventDefault()}>
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: colour(items[0]!.statusColor) }}
                  />
                  <Label className="!text-orv-text">{k}</Label>
                  <span className="text-[12px] text-orv-muted">{items.length}</span>
                </div>
                <ColumnDrop status={k} onDrop={(t) => void pickDrop(t, k)}>
                  {items.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-clickup', JSON.stringify(t))}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <ClickUpRow
                        task={t}
                        showStatus={false}
                        onOpen={openTask}
                        onStatus={(x) => void pickStatus(x)}
                        timing={timer?.taskId === t.id}
                      />
                    </div>
                  ))}
                </ColumnDrop>
              </Glass>
            );
          })}
        </div>
      ) : (
        <>
          {order.map((k) => {
            const items = groups.get(k)!;
            const f = folded(k);
            return (
              <Glass key={k} as="section" className="p-4">
                <button
                  type="button"
                  aria-expanded={!f}
                  onClick={() => setFlip((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}
                  className="flex w-full items-center gap-2 px-1 text-left"
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: colour(items[0]!.statusColor) }}
                  />
                  <Label className="!text-orv-text">{k}</Label>
                  <span className="text-[12px] text-orv-muted">{items.length}</span>
                  {isWorking(items[0]!) ? (
                    <span className="text-[11px] text-orv-accent">Shown in Today</span>
                  ) : null}
                  <span className="flex-1" />
                  {f ? (
                    <ChevronDown size={15} className="text-orv-muted" />
                  ) : (
                    <ChevronUp size={15} className="text-orv-muted" />
                  )}
                </button>
                {!f ? (
                  <ul className="mt-2 flex flex-col">
                    {items.map((t) => (
                      <ClickUpRow
                        key={t.id}
                        task={t}
                        showStatus={false}
                        onOpen={openTask}
                        onStatus={(x) => void pickStatus(x)}
                        timing={timer?.taskId === t.id}
                      />
                    ))}
                  </ul>
                ) : null}
              </Glass>
            );
          })}
          <Glass as="section" className="p-4">
            <button
              type="button"
              aria-expanded={showClosed}
              onClick={() => setShowClosed((v) => !v)}
              className="flex w-full items-center gap-2 px-1 text-left"
            >
              <CircleCheck size={14} className="text-orv-success" aria-hidden />
              <Label className="!text-orv-success">Done &amp; closed · 30 days</Label>
              <span className="flex-1" />
              {showClosed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showClosed ? (
              closedData.data === undefined ? (
                <SkeletonRows rows={2} className="mt-2" />
              ) : (
                <ul className="mt-2 flex flex-col">
                  {closedData.data.length === 0 ? (
                    <li className="px-1 text-small text-orv-muted">Nothing closed lately.</li>
                  ) : null}
                  {closedData.data
                    .filter(
                      (t) =>
                        (!list || t.list === list) && (!q || t.name.toLowerCase().includes(q.toLowerCase())),
                    )
                    .map((t) => (
                      <ClickUpRow
                        key={t.id}
                        task={t}
                        onOpen={openTask}
                        onStatus={(x) => void pickStatus(x)}
                      />
                    ))}
                </ul>
              )
            ) : null}
          </Glass>
        </>
      )}
      {ui}
    </div>
  );

  async function pickDrop(t: HubTask, status: string) {
    if (t.status.toLowerCase() === status.toLowerCase()) return;
    await setClickUpStatus(t, status).catch(() => undefined);
  }
}

function ColumnDrop({
  status,
  onDrop,
  children,
}: {
  status: string;
  onDrop(t: HubTask): void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <ul
      aria-label={`Drop on ${status}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData('application/x-clickup');
        if (raw) onDrop(JSON.parse(raw) as HubTask);
      }}
      className={cn(
        'flex min-h-24 flex-1 flex-col rounded-orv-md transition-colors',
        over && 'bg-orv-track ring-1 ring-orv-accent',
      )}
    >
      {children}
    </ul>
  );
}

// ------------------------------------------------------------------ the task sheet

export function ClickUpTaskSheet({
  task,
  onClose,
  onStatus,
}: {
  task: HubTask | null;
  onClose(): void;
  onStatus(t: HubTask, statuses?: HubStatus[]): void | Promise<void>;
}) {
  const toast = useToast();
  const { ask, picker } = usePick();
  const d = useCached<HubDetail>(
    `clickup.task.${task?.id ?? 'none'}`,
    task
      ? `/connections/clickup/tasks/${encodeURIComponent(task.id)}?connectionId=${task.connectionId}`
      : null,
    30_000,
  );
  const timer = useTimer();
  const [comment, setComment] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = !!timer && timer.taskId === task?.id;
  useTick(running);
  const t: HubTask | null = d.data ? d.data.task : task;
  const mine = (d.data?.time ?? []).reduce((a, e) => a + e.minutes, 0);
  const due = t?.due ? new Date(t.due) : null;

  return (
    <Sheet
      open={!!task}
      onClose={onClose}
      title={t?.name ?? ''}
      subtitle={
        t ? (
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark id="clickup" size={14} /> {[t.folder, t.list].filter(Boolean).join(' › ')}
            {t.url ? (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-1 text-orv-accent hover:underline"
              >
                Open in ClickUp <ExternalLink size={11} />
              </a>
            ) : null}
          </span>
        ) : null
      }
      footer={
        t ? (
          <form
            className="flex w-full items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const text = comment.trim();
              if (!text) return;
              setComment('');
              try {
                await commentOn(t, text);
              } catch {
                setComment(text);
                toast({ title: 'Comment not sent', tone: 'danger' });
              }
            }}
          >
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
              rows={1}
              aria-label="Write a comment"
              placeholder="Write a comment…"
              className="field-ring max-h-32 min-h-10 flex-1 resize-none rounded-[20px] px-4 py-2 text-[15px] outline-none placeholder:text-orv-faint"
            />
            <button
              type="submit"
              aria-label="Send comment"
              disabled={!comment.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40 [background:var(--orv-accent-grad)]"
            >
              <ArrowUp size={17} />
            </button>
          </form>
        ) : null
      }
    >
      {t ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {t.status ? (
              <button
                type="button"
                onClick={() => void onStatus(t, d.data?.statuses)}
                aria-label={`Status ${t.status}. Change`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-extrabold uppercase tracking-wider text-white"
                style={{
                  background: colour(t.statusColor),
                  boxShadow: `0 4px 14px color-mix(in srgb, ${colour(t.statusColor)} 40%, transparent)`,
                }}
              >
                {t.status} <ChevronDown size={13} />
              </button>
            ) : null}
            <label className="relative">
              <FactPill
                icon={<CalendarDays size={13} />}
                label={due ? `Due ${dayWords(localDay(due))}` : 'Due date'}
                set={!!due}
                tone={due && localDay(due) < localDay(new Date()) ? 'var(--orv-danger)' : undefined}
                onClick={() =>
                  (document.getElementById(`due-${t.id}`) as HTMLInputElement | null)?.showPicker?.()
                }
              />
              <input
                id={`due-${t.id}`}
                type="date"
                aria-label="Due date"
                className="pointer-events-none absolute inset-0 opacity-0"
                value={due ? localDay(due) : ''}
                onChange={async (e) => {
                  try {
                    await setClickUpDue(t, e.target.value || null);
                  } catch {
                    toast({ title: 'ClickUp didn’t take it', tone: 'danger' });
                  }
                }}
              />
            </label>
            <FactPill
              icon={<Flag size={13} />}
              label={t.priority ? cap(t.priority) : 'Priority'}
              set={!!t.priority}
              tone={t.priority ? PRIO[t.priority] : undefined}
              onClick={async () => {
                const cur =
                  ({ urgent: 1, high: 2, normal: 3, low: 4 } as Record<string, number>)[t.priority ?? ''] ??
                  0;
                const v = await ask<number>('Priority', [
                  { value: 1, label: 'Urgent', colour: PRIO.urgent, selected: cur === 1 },
                  { value: 2, label: 'High', colour: PRIO.high, selected: cur === 2 },
                  { value: 3, label: 'Normal', colour: PRIO.normal, selected: cur === 3 },
                  { value: 4, label: 'Low', colour: PRIO.low, selected: cur === 4 },
                  { value: 0, label: 'None', selected: cur === 0 },
                ]);
                if (v === null || v === cur) return;
                await setClickUpPriority(t, v || null).catch(() =>
                  toast({ title: 'ClickUp didn’t take it', tone: 'danger' }),
                );
              }}
            />
          </div>
          {d.data?.task.assignees.length ? (
            <div className="flex items-center gap-2 text-small text-orv-muted">
              <span className="flex -space-x-1.5">
                {d.data.task.assignees.slice(0, 5).map((a) => (
                  <Avatar key={a.id} name={a.name} src={a.avatar} size={22} />
                ))}
              </span>
              {d.data.task.assignees.map((a) => a.name).join(', ')}
            </div>
          ) : null}

          {/* time */}
          <Glass className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Time</Label>
                <p className={cn('tabular font-mono text-title font-semibold', running && 'text-orv-danger')}>
                  {running ? clockOf(Date.now() - Date.parse(timer.startedAt)) : hm(t.trackedMin)}
                </p>
                <p className="text-[12px] text-orv-muted">
                  {running ? 'Running' : `tracked in all · ${hm(mine)} by you`}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={running ? 'Stop the timer' : 'Start the timer'}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (running) {
                      const m = await stopTimer(timer);
                      toast({ title: m ? `Logged ${hm(m)}` : 'Timer stopped', tone: 'success' });
                    } else {
                      await startTimer(t);
                      toast({ title: 'Timer started', body: t.name, tone: 'success' });
                    }
                  } catch {
                    toast({ title: 'ClickUp didn’t take it', tone: 'danger' });
                  } finally {
                    setBusy(false);
                  }
                }}
                className={cn(
                  'grid size-14 place-items-center rounded-full text-white transition-transform hover:scale-105 active:scale-95',
                  running ? 'bg-orv-danger' : '[background:var(--orv-accent-grad)]',
                )}
                style={{
                  boxShadow: `0 8px 22px color-mix(in srgb, ${running ? 'var(--orv-danger)' : 'var(--orv-accent-from)'} 40%, transparent)`,
                }}
              >
                {running ? <Square size={20} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add time
              </Button>
              {d.data?.time.length ? (
                <span className="text-[12px] text-orv-muted">{d.data.time.length} entries</span>
              ) : null}
            </div>
            {d.data?.time.length ? (
              <ul className="flex flex-col gap-1">
                {d.data.time.slice(0, 8).map((e) => (
                  <li key={e.id} className="group flex items-center gap-3 text-[13px]">
                    <Clock size={12} className="text-orv-faint" aria-hidden />
                    <span className="w-16 font-semibold">{hm(e.minutes)}</span>
                    <span className="flex-1 truncate text-orv-muted">
                      {dayWords(localDay(new Date(e.start)))} ·{' '}
                      {new Date(e.start).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${hm(e.minutes)}`}
                      className="text-orv-faint opacity-0 transition-opacity hover:text-orv-danger group-hover:opacity-100 focus:opacity-100"
                      onClick={async () => {
                        if (!confirm(`Delete ${hm(e.minutes)}? It is removed in ClickUp too.`)) return;
                        await deleteTime(t, e.id).catch(() =>
                          toast({ title: 'Couldn’t delete it', tone: 'danger' }),
                        );
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Glass>

          {d.data === undefined && d.error ? (
            <p className="text-small text-orv-muted">Couldn’t load the details.</p>
          ) : null}
          {d.data === undefined && !d.error ? <SkeletonRows rows={2} /> : null}

          {d.data?.task.description.trim() ? (
            <section>
              <Label>Description</Label>
              <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed">
                {plain(d.data.task.description)}
              </p>
            </section>
          ) : null}

          {d.data?.task.subtasks.length ? (
            <section>
              <Label>
                Subtasks · {d.data.task.subtasks.filter((s) => s.done).length}/{d.data.task.subtasks.length}
              </Label>
              <ul className="mt-1 flex flex-col gap-1">
                {d.data.task.subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-[14px]">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: s.done ? 'var(--orv-success)' : colour(s.statusColor) }}
                    />
                    <span className={cn(s.done && 'text-orv-muted line-through')}>{s.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <Label>Comments{d.data?.comments.length ? ` · ${d.data.comments.length}` : ''}</Label>
            {d.data && !d.data.comments.length ? (
              <p className="mt-1 text-small text-orv-muted">No comments yet. Say how it’s going.</p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-3">
              {d.data?.comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar name={c.by.name} src={c.by.avatar} size={28} />
                  <div
                    className={cn(
                      'min-w-0 flex-1 rounded-[4px_14px_14px_14px] px-3 py-2',
                      c.mine ? 'bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)]' : 'bg-orv-field',
                    )}
                  >
                    <p className="text-[12.5px]">
                      <b>{c.mine ? 'You' : c.by.name}</b>{' '}
                      <span className="text-orv-faint">
                        {new Date(c.at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap text-[14px]">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
      {picker}
      {t ? <AddTimeSheet task={t} open={adding} onClose={() => setAdding(false)} /> : null}
    </Sheet>
  );
}

const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .trim();

// ------------------------------------------------------------------ add time

/** Time by duration ("1h 30m" on a day) or by range (from–to on a day), with a note. */
export function AddTimeSheet({ task, open, onClose }: { task: HubTask; open: boolean; onClose(): void }) {
  const toast = useToast();
  const now = new Date();
  const [mode, setMode] = useState<'duration' | 'range'>('duration');
  const [day, setDay] = useState(localDay(now));
  const [h, setH] = useState(0);
  const [m, setM] = useState(30);
  const [from, setFrom] = useState(() => new Date(Date.now() - 3_600_000).toTimeString().slice(0, 5));
  const [to, setTo] = useState(() => new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const minutes = mode === 'duration' ? h * 60 + m : Math.max(0, toMin(to) - toMin(from));
  const start =
    mode === 'range'
      ? new Date(`${day}T${from}`)
      : new Date(
          (day === localDay(now) ? Date.now() : new Date(`${day}T18:00`).getTime()) - minutes * 60_000,
        );
  const future = start.getTime() > Date.now() + 60_000;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add time"
      subtitle={task.name}
      footer={
        <>
          <span className={cn('mr-auto text-small', future ? 'text-orv-danger' : 'text-orv-muted')}>
            {future ? 'Time can’t be in the future' : `${hm(minutes)} on ${dayWords(day)}`}
          </span>
          <Button
            variant="primary"
            loading={busy}
            disabled={minutes < 1 || future}
            onClick={async () => {
              setBusy(true);
              try {
                await addTime(task, start, minutes, note.trim() || undefined);
                toast({ title: `Logged ${hm(minutes)}`, body: task.name, tone: 'success' });
                onClose();
              } catch {
                toast({ title: 'ClickUp didn’t take it', tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          >
            Log {hm(minutes)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented<'duration' | 'range'>
          label="How"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'duration', label: 'Duration' },
            { value: 'range', label: 'From – to' },
          ]}
        />
        <Field label="Day">
          {(id) => (
            <Input
              id={id}
              type="date"
              max={localDay(now)}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          )}
        </Field>
        {mode === 'duration' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={23}
                    value={h}
                    onChange={(e) => setH(Math.max(0, Math.min(23, +e.target.value || 0)))}
                  />
                )}
              </Field>
              <Field label="Minutes">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={59}
                    step={5}
                    value={m}
                    onChange={(e) => setM(Math.max(0, Math.min(59, +e.target.value || 0)))}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 90, 120, 240].map((x) => (
                <FactPill
                  key={x}
                  icon={<Timer size={13} />}
                  label={hm(x)}
                  set={minutes === x}
                  onClick={() => {
                    setH(Math.floor(x / 60));
                    setM(x % 60);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              {(id) => <Input id={id} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label="To">
              {(id) => <Input id={id} type="time" value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </div>
        )}
        <Field label="Note (optional)">
          {(id) => (
            <Input
              id={id}
              value={note}
              maxLength={1000}
              placeholder="What you did"
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ "Show in Today"

export function ClickUpStatusesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const st = useCached<
    { connectionId: string; account: string; statuses: (HubStatus & { working: boolean })[] }[]
  >('clickup.statuses', open ? '/connections/clickup/statuses' : null, 60_000);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (st.data)
      setPicked(
        Object.fromEntries(
          st.data.map((a) => [
            a.connectionId,
            a.statuses.filter((s) => s.working).map((s) => s.name.toLowerCase()),
          ]),
        ),
      );
  }, [st.data]);
  const save = async (reset = false) => {
    const { api } = await import('@/lib/api');
    try {
      for (const a of st.data ?? [])
        await api('/connections/clickup/settings', {
          method: 'PUT',
          body: {
            connectionId: a.connectionId,
            workingStatuses: reset ? null : (picked[a.connectionId] ?? []),
          },
        });
      invalidate('clickup.');
      onClose();
    } catch {
      toast({ title: 'Couldn’t save', tone: 'danger' });
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Show in Today"
      subtitle="Tasks in these statuses are what you’re working on. Everything else stays on the ClickUp page."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => void save(true)}>
            Use the default
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      {st.data === undefined ? <SkeletonRows rows={4} icon={false} /> : null}
      {st.data?.map((a) => (
        <div key={a.connectionId} className="flex flex-col gap-1">
          {st.data!.length > 1 ? <Label>{a.account}</Label> : null}
          {a.statuses.map((s) => {
            const k = s.name.toLowerCase();
            const on = picked[a.connectionId]?.includes(k) ?? false;
            return (
              <div key={k} className="flex items-center gap-3 py-1.5">
                <span className="size-3 rounded-full" style={{ background: colour(s.color) }} />
                <span className="flex-1 text-[15px] font-medium">{cap(s.name)}</span>
                <Switch
                  label={`Show ${s.name} in Today`}
                  checked={on}
                  onChange={(v: boolean) =>
                    setPicked((p) => ({
                      ...p,
                      [a.connectionId]: v
                        ? [...(p[a.connectionId] ?? []), k]
                        : (p[a.connectionId] ?? []).filter((x) => x !== k),
                    }))
                  }
                />
              </div>
            );
          })}
        </div>
      ))}
    </Sheet>
  );
}
