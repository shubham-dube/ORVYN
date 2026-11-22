'use client';

import { doneDayHeader, doneLabel, type Task } from '@orvyn/contracts';
import {
  AlarmClock,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  FlagTriangleRight,
  History,
  Inbox,
  ListChecks,
  Repeat,
  StickyNote,
  Sun,
  Timer,
  Video,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Glass, Label, Segmented, SkeletonRows } from '@/components/ui/bits';
import { openMeeting } from '@/components/connections';
import { TimerPill, WorkingOn } from '@/components/clickup';
import { GitHubCard } from '@/components/prs';
import { QuickAdd } from '@/components/quick-add';
import { ScheduleGroup } from '@/components/schedule';
import { type NewTask, TaskSheet } from '@/components/task-sheet';
import { CalendarViews } from '@/components/today-calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { groupTasks, localDay, taskDay, taskMoment, useToday } from '@/lib/today';
import { dayWords, deadlineTone, hm } from '@/lib/work';
import { Board, colourOf, PriorityFlag, SelectBar, TaskToolbar } from '@/components/task-views';
import { checklistProgress, EMPTY_QUERY, isEmptyQuery, taskMatches, type TaskQuery } from '@orvyn/today-plan';

export default function TodayPage() {
  return (
    <div data-module="today">
      <TodayView />
    </div>
  );
}

type Scope = 'all' | 'today' | 'upcoming' | 'inbox' | 'done';

function TodayView() {
  const { ready, tasks, pending, projects, settings } = useToday();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState<NewTask | null>(null);
  const [mode, setMode] = useState<'list' | 'board' | 'calendar'>('list');
  const [query, setQuery] = useState<TaskQuery>(EMPTY_QUERY);
  const [scope, setScope] = useState<Scope>('all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const tz = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    try {
      const m = localStorage.getItem('orvyn.today.mode');
      if (m === 'calendar' || m === 'board') setMode(m);
    } catch {
      /* storage blocked: start on the list */
    }
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && leaveSelecting();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const pickMode = (m: 'list' | 'board' | 'calendar') => {
    setMode(m);
    try {
      localStorage.setItem('orvyn.today.mode', m);
    } catch {
      /* fine */
    }
  };
  const filtered = useMemo(
    () => (isEmptyQuery(query) ? tasks : tasks.filter((t) => taskMatches(t, query, now, tz))),
    [tasks, query, now, tz],
  );
  const g = useMemo(() => groupTasks(filtered, now), [filtered, now]);
  const pickedTasks = tasks.filter((t) => picked.includes(t.id));
  const toggle = (t: Task) =>
    setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]));
  const open = (t: Task) => (selecting ? toggle(t) : setEditing(t));
  const hold = (t: Task) => {
    if (selecting) return toggle(t);
    setSelecting(true);
    setPicked([t.id]);
  };
  function leaveSelecting() {
    setSelecting(false);
    setPicked([]);
  }
  const row = { now, selecting, picked, onOpen: open, onHold: hold };
  const filtering = !isEmptyQuery(query);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1 className="text-title font-semibold">Today</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimerPill />
          {pending ? <Badge>{pending} waiting to sync</Badge> : null}
          <Button variant="secondary" size="sm" onClick={openMeeting} aria-label="Schedule a meeting">
            <Video size={15} /> <span className="hidden sm:inline">Meeting</span>
          </Button>
          <Segmented
            label="Today view"
            value={mode}
            onChange={pickMode}
            options={[
              { value: 'list', label: 'List' },
              { value: 'board', label: 'Board' },
              { value: 'calendar', label: 'Calendar' },
            ]}
          />
        </div>
      </header>

      <QuickAdd onExpand={setCreating} />

      {ready && mode !== 'calendar' ? (
        selecting ? (
          <div className="flex h-11 items-center gap-2 rounded-orv-md border border-[color-mix(in_srgb,var(--orv-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)] px-2">
            <button
              type="button"
              aria-label="Stop selecting"
              onClick={leaveSelecting}
              className="grid size-8 place-items-center rounded-full hover:bg-orv-track"
            >
              <X size={16} />
            </button>
            <span className="flex-1 text-[15px] font-bold">
              {picked.length ? `${picked.length} selected` : 'Tap tasks to select'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const openIds = filtered.filter((t) => !t.completedAt).map((t) => t.id);
                setPicked((p) => (p.length >= openIds.length ? [] : openIds));
              }}
            >
              Select all
            </Button>
          </div>
        ) : (
          <TaskToolbar
            query={query}
            setQuery={setQuery}
            tasks={tasks}
            projects={projects}
            selecting={selecting}
            setSelecting={(v) => (v ? setSelecting(true) : leaveSelecting())}
          />
        )
      ) : null}

      {ready && mode === 'calendar' ? (
        <CalendarViews onOpenTask={setEditing} />
      ) : !ready ? (
        <SkeletonRows rows={5} label="Loading tasks" />
      ) : mode === 'board' ? (
        <Board tasks={filtered} projects={projects} onOpen={open} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Segmented<Scope>
              label="Show"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'inbox', label: 'Inbox' },
                { value: 'done', label: 'Done' },
              ]}
            />
          </div>
          {scope === 'done' ? (
            <DoneByDay tasks={filtered.filter((t) => t.completedAt)} row={row} tz={tz} />
          ) : (
            <>
              {(scope === 'all' || scope === 'today') && !filtering ? (
                <ScheduleGroup
                  onFollowUp={(title) => setCreating({ title, dueDate: localDay(new Date()) })}
                />
              ) : null}
              {scope === 'all' || scope === 'today' ? (
                <>
                  {g.overdue.length ? (
                    <Section
                      title="Overdue"
                      icon={<AlarmClock size={14} />}
                      tone="danger"
                      items={g.overdue}
                      row={row}
                    />
                  ) : null}
                  <Section
                    title="Today"
                    icon={<Sun size={14} />}
                    items={g.today}
                    row={row}
                    empty={
                      filtering
                        ? 'Nothing matches today.'
                        : 'Nothing planned for today. Add something above, or enjoy it.'
                    }
                  />
                  {!filtering ? <WorkingOn /> : null}
                </>
              ) : null}
              {(scope === 'all' && g.upcoming.length) || scope === 'upcoming' ? (
                <Section
                  title="Upcoming"
                  icon={<CalendarDays size={14} />}
                  items={g.upcoming}
                  row={row}
                  empty="Nothing coming up."
                  dayHeaders
                />
              ) : null}
              {scope === 'all' || scope === 'inbox' ? (
                <Section
                  title="Inbox"
                  icon={<Inbox size={14} />}
                  items={g.inbox}
                  row={row}
                  hint={g.inbox.length ? 'No day yet — give one a day to plan it.' : undefined}
                  empty={filtering ? 'Nothing matches in the Inbox.' : 'Inbox zero — everything has a day.'}
                />
              ) : null}
              {scope === 'all' && g.doneToday.length ? (
                <Section
                  title="Done today"
                  icon={<CheckCheck size={14} />}
                  tone="success"
                  items={g.doneToday}
                  row={row}
                  collapsible
                />
              ) : null}
              {scope === 'all' && !filtering ? <GitHubCard /> : null}
            </>
          )}
        </>
      )}

      <AnimatePresence>
        {selecting ? <SelectBar picked={pickedTasks} projects={projects} clear={leaveSelecting} /> : null}
      </AnimatePresence>

      <TaskSheet
        task={editing}
        initial={creating}
        onClose={() => {
          setEditing(null);
          setCreating(null);
        }}
      />
    </div>
  );
}

interface RowCtx {
  now: Date;
  selecting: boolean;
  picked: string[];
  onOpen(t: Task): void;
  onHold(t: Task): void;
}

function Section({
  title,
  items,
  row,
  icon,
  tone,
  empty,
  hint,
  collapsible,
  dayHeaders,
}: {
  title: string;
  items: Task[];
  row: RowCtx;
  icon?: React.ReactNode;
  tone?: 'danger' | 'success';
  empty?: string;
  hint?: string;
  collapsible?: boolean;
  dayHeaders?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const c =
    tone === 'danger' ? 'text-orv-danger' : tone === 'success' ? 'text-orv-success' : 'text-orv-accent';
  let last: string | null = null;
  return (
    <Glass as="section" className="p-4" aria-label={`${title} section`}>
      <button
        type="button"
        disabled={!collapsible}
        aria-expanded={collapsible ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center gap-2 px-1 text-left disabled:cursor-default"
      >
        <span className={c} aria-hidden>
          {icon}
        </span>
        <Label className={tone ? (tone === 'danger' ? '!text-orv-danger' : '!text-orv-success') : ''}>
          {title}
        </Label>
        {items.length ? <span className="text-[12px] text-orv-muted">{items.length}</span> : null}
        <span className="flex-1" />
        {collapsible ? (
          open ? (
            <ChevronUp size={15} className="text-orv-muted" />
          ) : (
            <ChevronDown size={15} className="text-orv-muted" />
          )
        ) : null}
      </button>
      {hint ? <p className="mb-1 px-1 text-[12px] text-orv-muted">{hint}</p> : null}
      {open ? (
        <ul className="flex flex-col" aria-label={title}>
          <AnimatePresence initial={false}>
            {items.map((t) => {
              const d = taskDay(t);
              const header = dayHeaders && d !== last ? ((last = d), d) : null;
              return (
                <motion.li
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={spring.smooth}
                >
                  {header ? (
                    <p className="px-1 pb-0.5 pt-2 text-[12px] font-bold text-orv-muted">
                      {dayWords(header, row.now)}
                    </p>
                  ) : null}
                  <TaskRow task={t} row={row} />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      ) : null}
      {!items.length && empty ? <p className="px-1 py-2 text-small text-orv-muted">{empty}</p> : null}
    </Glass>
  );
}

/** The Done tab: day headers, newest first, a month at a time (spec 0012 A1). */
function DoneByDay({ tasks, row, tz }: { tasks: Task[]; row: RowCtx; tz: string }) {
  const [days, setDays] = useState(30);
  const all = [...tasks].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const since = row.now.getTime() - days * 86_400_000;
  const shown = all.filter((t) => Date.parse(t.completedAt!) > since);
  const groups = new Map<string, Task[]>();
  for (const t of shown) {
    const k = doneDayHeader(t.completedAt!, row.now, tz);
    const list = groups.get(k);
    if (list) list.push(t);
    else groups.set(k, [t]);
  }
  if (!all.length)
    return (
      <Glass className="p-5 text-small text-orv-muted">
        Nothing finished yet. It’ll all be here, by day.
      </Glass>
    );
  return (
    <>
      {[...groups.entries()].map(([k, items]) => (
        <Section key={k} title={k} icon={<Check size={14} />} tone="success" items={items} row={row} />
      ))}
      {shown.length < all.length ? (
        <Button variant="ghost" className="self-center" onClick={() => setDays((d) => d + 60)}>
          <History size={15} /> Show older ({all.length - shown.length})
        </Button>
      ) : null}
    </>
  );
}

/** One task: a circle to tick (a checkbox while selecting), the title, what matters about it (spec 0012 A1, A7). */
function TaskRow({ task, row }: { task: Task; row: RowCtx }) {
  const { updateTask, projects, settings } = useToday();
  const [settling, setSettling] = useState(false);
  const tz = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const done = !!task.completedAt;
  const selected = row.picked.includes(task.id);
  const project = projects.find((p) => p.id === task.projectId);
  const moment = taskMoment(task);
  const day = taskDay(task);
  const today = localDay(row.now);
  const dl = deadlineTone(task.deadline, row.now);
  const prog = checklistProgress(task);
  const [press, setPress] = useState<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => {
    if (press) clearTimeout(press);
    setPress(null);
  };
  const toggle = async () => {
    if (!done) {
      setSettling(true);
      await new Promise((r) => setTimeout(r, 380));
    }
    await updateTask(task.id, { completedAt: done ? null : new Date().toISOString() });
    setSettling(false);
  };
  return (
    <div
      aria-selected={row.selecting ? selected : undefined}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') setPress(setTimeout(() => row.onHold(task), 500));
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      className={cn(
        'group flex items-center gap-3 rounded-orv-md border px-1.5 py-2 transition-colors',
        selected
          ? 'border-[color-mix(in_srgb,var(--orv-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)]'
          : 'border-transparent hover:bg-orv-track',
      )}
    >
      {row.selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${task.title}`}
          onClick={() => row.onOpen(task)}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-[7px] border-2 transition-all',
            selected
              ? 'scale-105 border-transparent text-white shadow-[0_0_10px_color-mix(in_srgb,var(--orv-accent-from)_40%,transparent)] [background:var(--orv-accent-grad)]'
              : 'border-orv-faint',
          )}
        >
          {selected ? <Check size={15} strokeWidth={3} /> : null}
        </button>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`${done ? 'Mark not done' : 'Complete'} ${task.title}`}
          onClick={() => void toggle()}
          className={cn(
            'relative grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
            done || settling
              ? 'border-transparent text-white [background:var(--orv-accent-grad)]'
              : task.status === 'doing'
                ? 'border-orv-accent'
                : 'border-orv-faint hover:border-orv-accent',
          )}
        >
          {done || settling ? (
            <Check size={14} strokeWidth={3} aria-hidden />
          ) : task.status === 'doing' ? (
            <span className="size-2.5 rounded-full bg-orv-accent" />
          ) : null}
          {settling ? (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full"
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: 0.38, ease: 'easeOut' }}
              style={{ background: 'radial-gradient(circle, var(--orv-accent-from), transparent 70%)' }}
            />
          ) : null}
        </button>
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        onClick={() => row.onOpen(task)}
        onContextMenu={(e) => {
          e.preventDefault();
          row.onHold(task);
        }}
      >
        <span
          className={cn('line-clamp-2 text-[15px]', done ? 'text-orv-muted line-through' : 'font-medium')}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-orv-muted">
          {done ? (
            <span className="inline-flex items-center gap-1 text-orv-success">
              <Check size={11} aria-hidden /> {doneLabel(task.completedAt!, row.now, tz)}
            </span>
          ) : null}
          {!done && task.status === 'doing' ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] px-1.5 text-[9.5px] font-extrabold uppercase tracking-wider text-orv-accent">
              Doing
            </span>
          ) : null}
          {!done && moment ? (
            <span className={cn(moment < row.now.getTime() && 'text-orv-danger')}>
              {day && day !== today ? `${dayWords(day, row.now)}, ` : ''}
              {new Date(moment).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          ) : !done && day && day !== today ? (
            <span className={cn(day < today && 'text-orv-danger')}>{dayWords(day, row.now)}</span>
          ) : null}
          {task.durationMin ? (
            <span className="inline-flex items-center gap-1">
              <Timer size={11} aria-hidden /> {hm(task.durationMin)}
            </span>
          ) : null}
          {task.deadline && !done ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                dl === 'past' ? 'text-orv-danger' : dl === 'near' ? 'text-orv-warning' : '',
              )}
            >
              <FlagTriangleRight size={11} aria-hidden /> by {dayWords(task.deadline, row.now)}
            </span>
          ) : null}
          {project ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: colourOf(project) }} />{' '}
              {project.name}
            </span>
          ) : null}
          {prog.total ? (
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${prog.done} of ${prog.total} steps done`}
            >
              <ListChecks size={11} aria-hidden /> {prog.done}/{prog.total}
            </span>
          ) : null}
          {task.rrule ? <Repeat size={11} aria-label="Repeats" /> : null}
          {task.notes.trim() ? <StickyNote size={11} aria-label="Has notes" /> : null}
          {task.tags.slice(0, 2).map((t) => (
            <span key={t} className="text-orv-faint">
              #{t}
            </span>
          ))}
        </span>
      </button>
      {task.priority >= 1 && !done ? <PriorityFlag p={task.priority} /> : null}
    </div>
  );
}
