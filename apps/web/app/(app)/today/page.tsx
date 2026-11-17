'use client';

import type { Task } from '@orvyn/contracts';
import { CalendarDays, Check, Flag, Inbox, Plus, Sun, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet } from '@/components/ui/bits';
import { CalendarViews } from '@/components/today-calendar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { TaskChips } from '@/components/task-chips';
import { LeadTimes, leadLabel } from '@/components/today-settings';
import { smartParse, taskFields } from '@/lib/smart-task';
import { groupTasks, localDay, taskMoment, useToday } from '@/lib/today';

export default function TodayPage() {
  return (
    <div data-module="today">
      <TodayView />
    </div>
  );
}

function TodayView() {
  const { ready, tasks, pending } = useToday();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<Task | null>(null);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    try {
      if (localStorage.getItem('orvyn.today.mode') === 'calendar') setMode('calendar');
    } catch {
      /* storage blocked: start on the list */
    }
    return () => clearInterval(t);
  }, []);
  const pickMode = (m: 'list' | 'calendar') => {
    setMode(m);
    try {
      localStorage.setItem('orvyn.today.mode', m);
    } catch {
      /* fine */
    }
  };
  const g = useMemo(() => groupTasks(tasks, now), [tasks, now]);

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
              { value: 'calendar', label: 'Calendar' },
            ]}
          />
        </div>
      </header>

      <QuickAdd />

      {ready && mode === 'calendar' ? (
        <CalendarViews onOpenTask={setEditing} />
      ) : !ready ? (
        <Glass className="p-5">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton mt-3 h-4 w-1/2 rounded" />
        </Glass>
      ) : (
        <>
          {g.overdue.length ? (
            <Section title="Overdue" tone="danger" items={g.overdue} onOpen={setEditing} now={now} />
          ) : null}
          <Section
            title="Today"
            icon={<Sun size={14} aria-hidden />}
            items={g.today}
            onOpen={setEditing}
            now={now}
            empty="Nothing planned for today. Add something above, or enjoy it."
          />
          {g.upcoming.length ? (
            <Section
              title="Upcoming"
              icon={<CalendarDays size={14} aria-hidden />}
              items={g.upcoming}
              onOpen={setEditing}
              now={now}
            />
          ) : null}
          <Section
            title="Inbox"
            icon={<Inbox size={14} aria-hidden />}
            items={g.inbox}
            onOpen={setEditing}
            now={now}
            empty="Inbox zero."
          />
          {g.doneToday.length ? (
            <Section title="Done today" items={g.doneToday} onOpen={setEditing} now={now} muted />
          ) : null}
        </>
      )}

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
    const d = new Date();
    if (when === 'tomorrow') d.setDate(d.getDate() + 1);
    const fields = taskFields(parsed, when === 'inbox' ? null : localDay(d));
    if (parsed.projectName) fields.projectId = await addProject(parsed.projectName);
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
}: {
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
            <TaskRow key={t.id} task={t} onOpen={onOpen} now={now} muted={muted} />
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
}: {
  task: Task;
  onOpen(t: Task): void;
  now: Date;
  muted?: boolean;
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
      className="group flex items-center gap-3 rounded-orv-md px-1 py-2 hover:bg-orv-track"
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
          {project ? <span>· {project.name}</span> : null}
          {task.rrule ? <span>· repeats</span> : null}
        </span>
      </button>
      {task.priority >= 2 ? (
        <Flag
          size={14}
          aria-label={task.priority === 3 ? 'High priority' : 'Medium priority'}
          className={task.priority === 3 ? 'text-orv-danger' : 'text-orv-warning'}
        />
      ) : null}
    </motion.li>
  );
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose(): void }) {
  const { updateTask, removeTask, projects, settings } = useToday();
  const [draft, setDraft] = useState<Task | null>(task);
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
        <TaskReminders
          draft={draft}
          defaults={settings?.reminders.timed ?? null}
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
  onChange,
}: {
  draft: Task;
  defaults: number[] | null;
  onChange(r: Task['reminders']): void;
}) {
  const own = (draft.reminders ?? []).flatMap((r) => (r.kind === 'before' ? [r.minutes] : []));
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
            v === 'custom' ? (defaults ?? []).map((minutes) => ({ kind: 'before' as const, minutes })) : null,
          )
        }
        options={[
          { value: 'defaults', label: 'My defaults' },
          { value: 'custom', label: 'Just for this task' },
        ]}
      />
      {custom ? (
        <LeadTimes
          label="Remind me"
          value={own}
          onChange={(m) => onChange(m.map((minutes) => ({ kind: 'before' as const, minutes })))}
        />
      ) : (
        <p className="text-small text-orv-muted">
          {defaults
            ? defaults.length
              ? defaults.map(leadLabel).join(', ')
              : 'No reminder'
            : 'Set your defaults in Settings → Today.'}
        </p>
      )}
    </div>
  );
}
