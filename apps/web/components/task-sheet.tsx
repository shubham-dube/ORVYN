'use client';

import { doneLabel, type ReminderWay, type Task } from '@orvyn/contracts';
import { allTags } from '@orvyn/today-plan';
import {
  BellRing,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  Clock,
  Flag,
  FlagTriangleRight,
  Folder,
  FolderPlus,
  Hash,
  ListChecks,
  Plus,
  Repeat,
  StickyNote,
  Timer,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Label, Segmented, Sheet, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input, TextArea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { localDay, taskDay, useToday } from '@/lib/today';
import { dayWords, deadlineTone, hm } from '@/lib/work';
import { FactPill, usePick } from './pick';
import { RepeatBuilder } from './repeat-builder';
import { ChecklistEditor, colourOf, TagsInput } from './task-views';
import { LeadTimes, leadLabel } from './today-settings';
import { WaysPicker, waysLabel } from './ways-picker';

export type NewTask = Partial<Task> & { title: string; _newProject?: string | null };

/**
 * The task sheet (spec 0012 A3), for a task or a new one: a big title, the facts as pills (When · Time ·
 * Duration · Priority · Project · Deadline), and "+" rows that open only when used.
 */
export function TaskSheet({
  task,
  initial,
  onClose,
}: {
  /** an existing task, or null with `initial` for a new one */
  task: Task | null;
  initial?: NewTask | null;
  onClose(): void;
}) {
  const open = !!task || !!initial;
  const isNew = !task;
  const { updateTask, removeTask, addTask, addProject, projects, settings, tasks } = useToday();
  const toast = useToast();
  const { ask, picker } = usePick();
  const [d, setD] = useState<NewTask | null>(null);
  const [day, setDay] = useState<string>('');
  const [time, setTime] = useState<string>('');
  const [opened, setOpened] = useState<string[]>([]);
  const [whenOpen, setWhenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const src = task ?? initial ?? null;
    setD(src ? { ...src } : null);
    const dd = src ? (src.dueAt ? localDay(new Date(src.dueAt)) : (taskDay(src as Task) ?? '')) : '';
    setDay(dd);
    setTime(src?.dueAt ? new Date(src.dueAt).toTimeString().slice(0, 5) : '');
    setWhenOpen(false);
    setOpened(
      src
        ? [
            src.notes ? 'notes' : '',
            src.checklist?.length ? 'checklist' : '',
            src.tags?.length ? 'tags' : '',
            src.rrule ? 'repeat' : '',
            src.reminders ? 'reminders' : '',
          ].filter(Boolean)
        : [],
    );
  }, [task, initial]);
  if (!d)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const set = (p: Partial<NewTask>) => setD({ ...d, ...p });
  const now = new Date();
  const today = localDay(now);
  const done = !!d.completedAt;
  const project = projects.find((p) => p.id === d.projectId);
  const dl = deadlineTone(d.deadline);

  const fields = (): Partial<Task> => ({
    title: d.title.trim(),
    notes: d.notes ?? '',
    dueDate: day && !time ? day : null,
    dueAt: day && time ? new Date(`${day}T${time}`).toISOString() : null,
    ...(task && day !== (taskDay(task) ?? '') ? { scheduledStart: null } : {}),
    priority: d.priority ?? 0,
    projectId: d.projectId ?? null,
    durationMin: d.durationMin ?? null,
    deadline: d.deadline ?? null,
    status: d.status ?? 'todo',
    tags: d.tags ?? [],
    checklist: d.checklist ?? [],
    rrule: d.rrule ?? null,
    reminders: d.reminders ?? null,
    ...(d.rrule && !day ? { dueDate: today } : {}),
    ...(task ? { completedAt: d.completedAt ?? null } : {}),
  });

  const save = async () => {
    if (!d.title.trim()) return;
    setBusy(true);
    try {
      if (isNew) {
        const f = fields();
        if (d._newProject) f.projectId = await addProject(d._newProject);
        await addTask({ ...f, title: d.title.trim(), source: 'typed' });
        toast({ title: 'Added', body: d.title.trim(), tone: 'success' });
      } else {
        await updateTask(task.id, fields());
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const plusRow = (key: string, icon: React.ReactNode, label: string, editor: React.ReactNode) =>
    opened.includes(key) ? (
      <motion.section
        key={key}
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        transition={spring.smooth}
        className="flex flex-col gap-1.5"
      >
        <span className="flex items-center gap-1.5 text-orv-accent">
          {icon}
          <Label>{label}</Label>
        </span>
        {editor}
      </motion.section>
    ) : (
      <button
        key={key}
        type="button"
        onClick={() => setOpened((o) => [...o, key])}
        className="flex items-center gap-2.5 rounded-orv-sm px-0.5 py-1.5 text-left text-[15px] text-orv-muted hover:text-orv-text"
      >
        <Plus size={15} aria-hidden />
        <span className="text-orv-faint">{icon}</span>
        {label}
      </button>
    );

  const plus = (n: number) => localDay(new Date(now.getTime() + n * 86_400_000));
  const nextMon = plus((8 - now.getDay()) % 7 || 7);
  const sat = plus((6 - now.getDay() + 7) % 7);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? 'New task' : done ? 'Done' : 'Task'}
      footer={
        <>
          {!isNew ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="mr-auto"
              onClick={async () => {
                if (!confirm(`Delete “${task.title}”?`)) return;
                await removeTask(task.id);
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" variant="primary" loading={busy} disabled={!d.title.trim()}>
            {isNew ? 'Add task' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id="task-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-start gap-3">
          {!isNew ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={done}
              aria-label={done ? 'Mark not done' : 'Complete'}
              onClick={() => set({ completedAt: done ? null : new Date().toISOString() })}
              className={cn(
                'mt-2 grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors',
                done
                  ? 'border-transparent text-white [background:var(--orv-accent-grad)]'
                  : 'border-orv-faint hover:border-orv-accent',
              )}
            >
              {done ? <Check size={15} strokeWidth={3} /> : null}
            </button>
          ) : null}
          <textarea
            aria-label="Title"
            autoFocus={isNew && !d.title}
            value={d.title}
            rows={1}
            maxLength={500}
            placeholder="What needs doing?"
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void save();
              }
            }}
            className={cn(
              'field-sizing-content min-h-11 flex-1 resize-none bg-transparent py-1.5 text-[20px] font-semibold outline-none placeholder:text-orv-faint',
              done && 'text-orv-muted line-through',
            )}
          />
        </div>
        {done && task?.completedAt ? (
          <p className="-mt-2 flex items-center gap-1.5 pl-10 text-small font-semibold text-orv-success">
            <CircleCheck size={14} aria-hidden />{' '}
            {doneLabel(task.completedAt, now, Intl.DateTimeFormat().resolvedOptions().timeZone, true)}
          </p>
        ) : null}
        {!done ? (
          <div className="-mt-1 flex gap-1" role="radiogroup" aria-label="Status">
            {(
              [
                ['todo', 'To do', <Circle key="c" size={13} />],
                ['doing', 'Doing', <CircleDashed key="d" size={13} />],
              ] as const
            ).map(([v, name, icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={(d.status ?? 'todo') === v}
                onClick={() => set({ status: v })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-bold transition-colors',
                  (d.status ?? 'todo') === v
                    ? 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent'
                    : 'text-orv-muted hover:text-orv-text',
                )}
              >
                {icon} {name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <FactPill
            icon={<CalendarDays size={13} />}
            label={day ? dayWords(day) : 'When'}
            set={!!day}
            tone={day && day < today && !done ? 'var(--orv-danger)' : undefined}
            onClick={() => setWhenOpen((v) => !v)}
            onClear={() => {
              setDay('');
              setTime('');
            }}
          />
          <FactPill
            icon={<Clock size={13} />}
            label={
              time
                ? new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Time'
            }
            set={!!time}
            onClick={() => setWhenOpen(true)}
            onClear={() => setTime('')}
          />
          <FactPill
            icon={<Timer size={13} />}
            label={d.durationMin ? hm(d.durationMin) : 'Duration'}
            set={!!d.durationMin}
            onClick={async () => {
              const v = await ask<number>(
                'How long will it take?',
                [15, 30, 45, 60, 90, 120, 180, 240]
                  .map((m) => ({
                    value: m,
                    label: hm(m),
                    icon: <Timer size={16} />,
                    selected: d.durationMin === m,
                  }))
                  .concat([
                    { value: 0, label: 'No estimate', icon: <Timer size={16} />, selected: !d.durationMin },
                  ]),
              );
              if (v !== null) set({ durationMin: v || null });
            }}
            onClear={() => set({ durationMin: null })}
          />
          <FactPill
            icon={<Flag size={13} />}
            label={['Priority', 'Low', 'Medium', 'High'][d.priority ?? 0]!}
            set={(d.priority ?? 0) > 0}
            tone={
              ['', 'var(--orv-faint)', 'var(--orv-warning)', 'var(--orv-danger)'][d.priority ?? 0] ||
              undefined
            }
            onClick={async () => {
              const v = await ask<number>('Priority', [
                {
                  value: 3,
                  label: 'High',
                  sub: '!!! or p1',
                  colour: 'var(--orv-danger)',
                  selected: d.priority === 3,
                },
                {
                  value: 2,
                  label: 'Medium',
                  sub: '!! or p2',
                  colour: 'var(--orv-warning)',
                  selected: d.priority === 2,
                },
                {
                  value: 1,
                  label: 'Low',
                  sub: '! or p3',
                  colour: 'var(--orv-faint)',
                  selected: d.priority === 1,
                },
                { value: 0, label: 'None', selected: !d.priority },
              ]);
              if (v !== null) set({ priority: v });
            }}
            onClear={() => set({ priority: 0 })}
          />
          <FactPill
            icon={<Folder size={13} />}
            label={project?.name ?? d._newProject ?? 'Project'}
            set={!!project || !!d._newProject}
            tone={project ? colourOf(project) : undefined}
            onClick={async () => {
              const v = await ask<string>('Project', [
                ...projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  colour: colourOf(p),
                  selected: d.projectId === p.id,
                })),
                { value: '', label: 'No project', selected: !d.projectId },
                { value: '+', label: 'New project…', icon: <FolderPlus size={16} /> },
              ]);
              if (v === null) return;
              if (v === '+') {
                const name = prompt('Name of the new project')?.trim();
                if (name) set({ projectId: await addProject(name), _newProject: null });
                return;
              }
              set({ projectId: v || null, _newProject: null });
            }}
            onClear={() => set({ projectId: null, _newProject: null })}
          />
          <label className="relative inline-flex">
            <FactPill
              icon={<FlagTriangleRight size={13} />}
              label={d.deadline ? `by ${dayWords(d.deadline)}` : 'Deadline'}
              set={!!d.deadline}
              tone={dl === 'past' ? 'var(--orv-danger)' : dl === 'near' ? 'var(--orv-warning)' : undefined}
              onClick={() =>
                (document.getElementById('task-deadline') as HTMLInputElement | null)?.showPicker?.()
              }
              onClear={() => set({ deadline: null })}
            />
            <input
              id="task-deadline"
              type="date"
              aria-label="Deadline"
              tabIndex={-1}
              value={d.deadline ?? ''}
              onChange={(e) => set({ deadline: e.target.value || null })}
              className="pointer-events-none absolute inset-0 opacity-0"
            />
          </label>
        </div>

        {whenOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.snappy}
            className="glass-pane flex flex-col gap-3 p-3"
          >
            <div className="flex flex-wrap gap-1.5">
              {[
                [today, 'Today'],
                [plus(1), 'Tomorrow'],
                ...(sat !== today ? [[sat, 'This weekend']] : []),
                [nextMon, 'Next week'],
                ['', 'No day (Inbox)'],
              ].map(([v, name]) => (
                <FactPill
                  key={name}
                  icon={<CalendarDays size={13} />}
                  label={name!}
                  set={day === v}
                  onClick={() => setDay(v!)}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} />
              <Input
                type="time"
                aria-label="Time"
                value={time}
                disabled={!day}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </motion.div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          {plusRow(
            'notes',
            <StickyNote size={14} />,
            'Notes',
            <TextArea
              aria-label="Notes"
              rows={4}
              value={d.notes ?? ''}
              placeholder="Links, details, anything"
              onChange={(e) => set({ notes: e.target.value })}
            />,
          )}
          {plusRow(
            'checklist',
            <ListChecks size={14} />,
            'Checklist',
            <ChecklistEditor value={d.checklist ?? []} onChange={(checklist) => set({ checklist })} />,
          )}
          {plusRow(
            'tags',
            <Hash size={14} />,
            'Tags',
            <TagsInput
              value={d.tags ?? []}
              onChange={(tags) => set({ tags })}
              suggestions={allTags(tasks)}
            />,
          )}
          {plusRow(
            'repeat',
            <Repeat size={14} />,
            'Repeat',
            <RepeatBuilder
              value={d.rrule ?? ''}
              onChange={(rrule) => set({ rrule: rrule || null })}
              startDate={day || today}
              timeZone={d.timeZone ?? settings?.timeZone ?? 'Asia/Kolkata'}
            />,
          )}
          {plusRow(
            'reminders',
            <BellRing size={14} />,
            'Reminders',
            <TaskReminders
              timed={!!time}
              reminders={d.reminders ?? null}
              defaults={settings?.reminders.timed ?? null}
              defaultWays={settings?.reminders.via}
              onChange={(reminders) => set({ reminders })}
            />,
          )}
        </div>
      </form>
      {picker}
    </Sheet>
  );
}

/** A task's own reminders override the person's defaults (D17). */
function TaskReminders({
  timed,
  reminders,
  defaults,
  defaultWays,
  onChange,
}: {
  timed: boolean;
  reminders: Task['reminders'];
  defaults: number[] | null;
  defaultWays: ReminderWay[] | undefined;
  onChange(r: Task['reminders']): void;
}) {
  if (!timed)
    return (
      <p className="text-small text-orv-muted">
        This task has only a day, so it follows your “things with only a date” setting. Give it a time for its
        own reminders.
      </p>
    );
  const own = (reminders ?? []).flatMap((r) => (r.kind === 'before' ? [r.minutes] : []));
  const ownWays = reminders?.find((r) => r.via?.length)?.via ?? defaultWays;
  const custom = reminders !== null;
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
            onChange={(via) => onChange((reminders ?? []).map((r) => ({ ...r, via })))}
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
