'use client';

import type { ReminderWay, Task } from '@orvyn/contracts';
import { CalendarDays, Check, CheckCheck, Inbox, Plus, Repeat, Sun, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet } from '@/components/ui/bits';
import { CalendarViews } from '@/components/today-calendar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { WaysPicker, waysLabel } from '@/components/ways-picker';
import { TaskChips } from '@/components/task-chips';
import { LeadTimes, leadLabel } from '@/components/today-settings';
import { looksUnread, type Parsed } from '@orvyn/today-parse';
import { api } from '@/lib/api';
import { smartParse, taskFields } from '@/lib/smart-task';
import { groupTasks, localDay, taskMoment, useToday } from '@/lib/today';
import { RepeatBuilder } from '@/components/repeat-builder';
import {
  Board,
  BulkBar,
  ChecklistEditor,
  PriorityFlag,
  TagsInput,
  TaskToolbar,
} from '@/components/task-views';
import {
  allTags,
  checklistProgress,
  EMPTY_QUERY,
  isEmptyQuery,
  taskMatches,
  type TaskQuery,
} from '@orvyn/today-plan';

export default function TodayPage() {
  return (
    <div data-module="today">
      <TodayView />
    </div>
  );
}

function TodayView() {
  const { ready, tasks, pending, projects, settings } = useToday();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<Task | null>(null);
  const [mode, setMode] = useState<'list' | 'board' | 'calendar'>('list');
  const [query, setQuery] = useState<TaskQuery>(EMPTY_QUERY);
  const [scope, setScope] = useState<'all' | 'today' | 'upcoming' | 'inbox' | 'done'>('all');
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
  const done = useMemo(
    () =>
      filtered
        .filter((t) => t.completedAt)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 100),
    [filtered],
  );
  const pickedTasks = tasks.filter((t) => picked.includes(t.id));
  const open = (t: Task) =>
    selecting
      ? setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))
      : setEditing(t);
  const leaveSelecting = (v: boolean) => {
    setSelecting(v);
    if (!v) setPicked([]);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1 className="text-title font-semibold">Today</h1>
        </div>
        <div className="flex items-center gap-2">
          {pending ? <Badge>{pending} waiting to sync</Badge> : null}
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

      <QuickAdd />

      {ready && mode !== 'calendar' ? (
        <TaskToolbar
          query={query}
          setQuery={setQuery}
          tasks={tasks}
          projects={projects}
          selecting={selecting}
          setSelecting={leaveSelecting}
        />
      ) : null}

      {ready && mode === 'calendar' ? (
        <CalendarViews onOpenTask={setEditing} />
      ) : !ready ? (
        <Glass className="p-5">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton mt-3 h-4 w-1/2 rounded" />
        </Glass>
      ) : mode === 'board' ? (
        <Board tasks={filtered} projects={projects} onOpen={open} />
      ) : (
        <>
          <Segmented
            label="Show"
            value={scope}
            onChange={(v) => setScope(v as typeof scope)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'today', label: 'Today' },
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'inbox', label: 'Inbox' },
              { value: 'done', label: 'Done' },
            ]}
          />
          {scope === 'done' ? (
            <Section
              title="Done"
              icon={<CheckCheck size={14} aria-hidden />}
              items={done}
              onOpen={open}
              now={now}
              muted
              empty="Nothing finished yet."
              picked={picked}
            />
          ) : (
            <>
              {scope === 'all' || scope === 'today' ? (
                <>
                  {g.overdue.length ? (
                    <Section
                      title="Overdue"
                      tone="danger"
                      items={g.overdue}
                      onOpen={open}
                      now={now}
                      picked={picked}
                    />
                  ) : null}
                  <Section
                    title="Today"
                    icon={<Sun size={14} aria-hidden />}
                    items={g.today}
                    onOpen={open}
                    now={now}
                    picked={picked}
                    empty={
                      isEmptyQuery(query)
                        ? 'Nothing planned for today. Add something above, or enjoy it.'
                        : 'Nothing matches today.'
                    }
                  />
                </>
              ) : null}
              {(scope === 'all' || scope === 'upcoming') && (g.upcoming.length || scope === 'upcoming') ? (
                <Section
                  title="Upcoming"
                  icon={<CalendarDays size={14} aria-hidden />}
                  items={g.upcoming}
                  onOpen={open}
                  now={now}
                  picked={picked}
                  empty="Nothing coming up."
                />
              ) : null}
              {scope === 'all' || scope === 'inbox' ? (
                <Section
                  title="Inbox"
                  icon={<Inbox size={14} aria-hidden />}
                  items={g.inbox}
                  onOpen={open}
                  now={now}
                  picked={picked}
                  empty={isEmptyQuery(query) ? 'Inbox zero.' : 'Nothing matches in the inbox.'}
                />
              ) : null}
              {scope === 'all' && g.doneToday.length ? (
                <Section
                  title="Done today"
                  items={g.doneToday}
                  onOpen={open}
                  now={now}
                  muted
                  picked={picked}
                />
              ) : null}
            </>
          )}
        </>
      )}

      {selecting ? (
        <BulkBar
          picked={pickedTasks}
          projects={projects}
          clear={() => {
            setPicked([]);
            setSelecting(false);
          }}
        />
      ) : null}

      <TaskSheet task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function QuickAdd() {
  const { addTask, addProject, projects, settings } = useToday();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<'inbox' | 'today' | 'tomorrow'>('today');
  // chips the person removed: those words are read literally (kept with their text, so edits elsewhere don't shift them)
  const [literal, setLiteral] = useState<{ range: [number, number]; text: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const liveKey = JSON.stringify(
    literal.filter((l) => title.slice(l.range[0], l.range[1]) === l.text).map((l) => l.range),
  );
  const parsed = useMemo(
    () =>
      title.trim()
        ? smartParse(title, {
            timeZone: settings?.timeZone,
            projects,
            literal: JSON.parse(liveKey) as [number, number][],
          })
        : null,
    [title, settings?.timeZone, projects, liveKey],
  );
  const hasDay = !!(parsed?.dueAt || parsed?.dueDate);
  const submit = async () => {
    if (!parsed) return;
    // date/time words the rules couldn't read: let the server's AI have a look (online only; else as typed)
    let read: Parsed = parsed;
    if (looksUnread(parsed) && navigator.onLine) {
      read = await api<Parsed>('/today/parse', {
        method: 'POST',
        body: { text: title, ai: true, literal: JSON.parse(liveKey) as [number, number][] },
      }).catch(() => parsed);
    }
    const d = new Date();
    if (when === 'tomorrow') d.setDate(d.getDate() + 1);
    const fields = taskFields(read, when === 'inbox' ? null : localDay(d));
    if (read.projectName) fields.projectId = await addProject(read.projectName);
    await addTask({ ...fields, source: 'typed' });
    setTitle('');
    setLiteral([]);
    input.current?.focus();
  };
  return (
    <Glass level="float" className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Plus size={18} className="ml-1 shrink-0 text-orv-accent" aria-hidden />
          <input
            ref={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task… try “dentist fri 11 for 45m” or “kal shaam 6 baje call mom”"
            aria-label="New task"
            maxLength={500}
            className="h-11 flex-1 bg-transparent text-[16px] outline-none placeholder:text-orv-faint"
          />
        </form>
        <div className="flex items-center gap-2">
          {!hasDay ? (
            <Segmented<'inbox' | 'today' | 'tomorrow'>
              label="When"
              value={when}
              onChange={setWhen}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'tomorrow', label: 'Tomorrow' },
                { value: 'inbox', label: 'Someday' },
              ]}
            />
          ) : null}
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!title.trim()}>
            Add
          </Button>
        </div>
      </div>
      {parsed?.spans.length ? (
        <div className="flex items-center gap-2 pl-7">
          <span className="text-[12px] text-orv-muted">“{parsed.title}”</span>
          <TaskChips
            parsed={parsed}
            projects={projects}
            onRemove={(range, text) => setLiteral((l) => [...l, { range, text }])}
          />
        </div>
      ) : null}
    </Glass>
  );
}

function Section({
  title,
  items,
  onOpen,
  now,
  icon,
  tone,
  empty,
  muted,
  picked,
}: {
  picked?: string[];
  title: string;
  items: Task[];
  onOpen(t: Task): void;
  now: Date;
  icon?: React.ReactNode;
  tone?: 'danger';
  empty?: string;
  muted?: boolean;
}) {
  return (
    <Glass as="section" className="p-4">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={tone === 'danger' ? 'text-orv-danger' : 'text-orv-accent'}>{icon}</span>
        <Label className={tone === 'danger' ? '!text-orv-danger' : ''}>{title}</Label>
        {items.length ? <span className="text-[12px] text-orv-muted">{items.length}</span> : null}
      </div>
      <ul className="flex flex-col" aria-label={title}>
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onOpen={onOpen}
              now={now}
              muted={muted}
              picked={picked?.includes(t.id)}
            />
          ))}
        </AnimatePresence>
      </ul>
      {!items.length && empty ? <p className="px-1 py-2 text-small text-orv-muted">{empty}</p> : null}
    </Glass>
  );
}

function TaskRow({
  task,
  onOpen,
  now,
  muted,
  picked,
}: {
  task: Task;
  onOpen(t: Task): void;
  now: Date;
  muted?: boolean;
  picked?: boolean;
}) {
  const { updateTask, projects } = useToday();
  const [settling, setSettling] = useState(false);
  const done = !!task.completedAt;
  const project = projects.find((p) => p.id === task.projectId);
  const moment = taskMoment(task);
  const toggle = async () => {
    if (!done) {
      setSettling(true); // "settle": a small burst of light, then it sinks out of the list
      await new Promise((r) => setTimeout(r, 380));
    }
    await updateTask(task.id, { completedAt: done ? null : new Date().toISOString() });
    setSettling(false);
  };
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={spring.smooth}
      aria-selected={picked || undefined}
      className={cn(
        'group flex items-center gap-3 rounded-orv-md px-1 py-2 hover:bg-orv-track',
        picked && 'bg-orv-track ring-1 ring-orv-accent',
      )}
    >
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Mark not done' : 'Complete'} ${task.title}`}
        onClick={() => void toggle()}
        className={cn(
          'relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          done || settling
            ? 'border-transparent text-white [background:var(--orv-accent-grad)]'
            : 'border-orv-edge hover:border-orv-accent',
        )}
      >
        {done || settling ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
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
      <button className="flex min-w-0 flex-1 flex-col items-start text-left" onClick={() => onOpen(task)}>
        <span
          className={cn(
            'truncate text-[15px]',
            done || muted ? 'text-orv-muted line-through' : 'font-medium',
          )}
        >
          {task.title}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-orv-muted">
          {moment ? (
            <span className={cn(moment < now.getTime() && !done ? 'text-orv-danger' : '')}>
              {new Date(moment).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          ) : null}
          {!moment && task.dueDate && task.dueDate !== localDay(now) ? (
            <span>
              {new Date(`${task.dueDate}T00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </span>
          ) : null}
          {task.durationMin ? (
            <span>
              ·{' '}
              {task.durationMin >= 60
                ? `${+(task.durationMin / 60).toFixed(1)} h`
                : `${task.durationMin} min`}
            </span>
          ) : null}
          {project ? <span>· {project.name}</span> : null}
          {task.rrule ? (
            <span className="inline-flex items-center gap-1">
              · <Repeat size={11} aria-hidden /> repeats
            </span>
          ) : null}
          {checklistProgress(task).total ? (
            <span
              aria-label={`${checklistProgress(task).done} of ${checklistProgress(task).total} steps done`}
            >
              · {checklistProgress(task).done}/{checklistProgress(task).total}
            </span>
          ) : null}
          {task.tags.slice(0, 3).map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </span>
      </button>
      {task.priority >= 1 ? <PriorityFlag p={task.priority} /> : null}
    </motion.li>
  );
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose(): void }) {
  const { updateTask, removeTask, projects, settings, tasks, addProject } = useToday();
  const [draft, setDraft] = useState<Task | null>(task);
  const [newProject, setNewProject] = useState('');
  useEffect(() => setDraft(task), [task]);
  if (!draft)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const time = draft.dueAt ? new Date(draft.dueAt).toTimeString().slice(0, 5) : '';
  const day = draft.dueAt ? localDay(new Date(draft.dueAt)) : (draft.dueDate ?? '');
  const setWhen = (d: string, t: string) =>
    setDraft({
      ...draft,
      dueDate: d && !t ? d : null,
      dueAt: d && t ? new Date(`${d}T${t}`).toISOString() : null,
    });
  const save = async () => {
    await updateTask(draft.id, {
      title: draft.title.trim() || task!.title,
      notes: draft.notes,
      dueDate: draft.dueDate,
      dueAt: draft.dueAt,
      priority: draft.priority,
      projectId: draft.projectId,
      reminders: draft.reminders,
      tags: draft.tags,
      checklist: draft.checklist,
      durationMin: draft.durationMin,
      // a repeat needs a day to start from: today when none was chosen
      rrule: draft.rrule,
      ...(draft.rrule && !draft.dueDate && !draft.dueAt ? { dueDate: localDay(new Date()) } : {}),
    });
    onClose();
  };
  return (
    <Sheet open={!!task} onClose={onClose} title="Task">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={500}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day">
            {(id) => (
              <Input id={id} type="date" value={day} onChange={(e) => setWhen(e.target.value, time)} />
            )}
          </Field>
          <Field label="Time">
            {(id) => (
              <Input
                id={id}
                type="time"
                value={time}
                disabled={!day}
                onChange={(e) => setWhen(day, e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<string>
            label="Priority"
            value={String(draft.priority)}
            onChange={(v) => setDraft({ ...draft, priority: Number(v) })}
            options={[
              { value: '0', label: 'None' },
              { value: '1', label: 'Low' },
              { value: '2', label: 'Medium' },
              { value: '3', label: 'High' },
            ]}
          />
          {projects.length ? (
            <select
              aria-label="Project"
              value={draft.projectId ?? ''}
              onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}
              className="h-10 rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px]"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Takes">
            {(id) => (
              <select
                id={id}
                value={draft.durationMin ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, durationMin: e.target.value ? Number(e.target.value) : null })
                }
                className="h-12 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[15px]"
              >
                <option value="">No estimate</option>
                {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${m / 60} h` : `${m} min`}
                  </option>
                ))}
                {draft.durationMin && ![15, 30, 45, 60, 90, 120, 180, 240].includes(draft.durationMin) ? (
                  <option value={draft.durationMin}>{draft.durationMin} min</option>
                ) : null}
              </select>
            )}
          </Field>
          <Field label="Or start a new one">
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={newProject}
                  placeholder="Name"
                  maxLength={80}
                  onChange={(e) => setNewProject(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!newProject.trim()}
                  onClick={async () => {
                    const pid = await addProject(newProject.trim());
                    setDraft({ ...draft, projectId: pid });
                    setNewProject('');
                  }}
                >
                  Add
                </Button>
              </div>
            )}
          </Field>
        </div>
        <Field label="Tags">
          {() => (
            <TagsInput
              value={draft.tags}
              onChange={(tags) => setDraft({ ...draft, tags })}
              suggestions={allTags(tasks)}
            />
          )}
        </Field>
        <Field label="Steps">
          {() => (
            <ChecklistEditor
              value={draft.checklist}
              onChange={(checklist) => setDraft({ ...draft, checklist })}
            />
          )}
        </Field>
        <Field label="Repeats">
          {() => (
            <RepeatBuilder
              value={draft.rrule ?? ''}
              onChange={(rrule) => setDraft({ ...draft, rrule: rrule || null })}
              startDate={day || localDay(new Date())}
              timeZone={draft.timeZone}
            />
          )}
        </Field>
        <TaskReminders
          draft={draft}
          defaults={settings?.reminders.timed ?? null}
          defaultWays={settings?.reminders.via}
          onChange={(reminders) => setDraft({ ...draft, reminders })}
        />
        <Field label="Notes">
          {(id) => (
            <textarea
              id={id}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={4}
              className="w-full rounded-orv-md border border-orv-edge bg-orv-field p-3 text-[15px] outline-none"
            />
          )}
        </Field>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={async () => {
              await removeTask(draft.id);
              onClose();
            }}
          >
            <Trash2 size={14} /> Delete
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** A task's own reminders override the person's defaults (D17). */
function TaskReminders({
  draft,
  defaults,
  defaultWays,
  onChange,
}: {
  draft: Task;
  defaults: number[] | null;
  defaultWays: ReminderWay[] | undefined;
  onChange(r: Task['reminders']): void;
}) {
  const own = (draft.reminders ?? []).flatMap((r) => (r.kind === 'before' ? [r.minutes] : []));
  // one set of ways for the task's reminders (the data allows one per reminder; the sheet keeps it simple)
  const ownWays = draft.reminders?.find((r) => r.via?.length)?.via ?? defaultWays;
  const custom = draft.reminders !== null;
  if (!draft.dueAt && !draft.scheduledStart) {
    return (
      <p className="text-small text-orv-muted">
        Reminders: this task has only a day, so it follows your “things with only a date” setting.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Segmented<'defaults' | 'custom'>
        label="Reminders"
        value={custom ? 'custom' : 'defaults'}
        onChange={(v) =>
          onChange(
            v === 'custom'
              ? (defaults ?? []).map((minutes) => ({ kind: 'before' as const, minutes, via: defaultWays }))
              : null,
          )
        }
        options={[
          { value: 'defaults', label: 'My defaults' },
          { value: 'custom', label: 'Just for this task' },
        ]}
      />
      {custom ? (
        <>
          <LeadTimes
            label="Remind me"
            value={own}
            onChange={(m) =>
              onChange(m.map((minutes) => ({ kind: 'before' as const, minutes, via: ownWays })))
            }
          />
          <WaysPicker
            label="By"
            value={ownWays}
            onChange={(via) => onChange((draft.reminders ?? []).map((r) => ({ ...r, via })))}
          />
        </>
      ) : (
        <p className="text-small text-orv-muted">
          {defaults
            ? defaults.length
              ? `${defaults.map(leadLabel).join(', ')} · ${waysLabel(defaultWays)}`
              : 'No reminder'
            : 'Set your defaults in Settings → Today.'}
        </p>
      )}
    </div>
  );
}
