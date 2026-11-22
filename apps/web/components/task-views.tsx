'use client';

import type { Project, SavedFilter, Task } from '@orvyn/contracts';
import { doneLabel } from '@orvyn/contracts';
import {
  allTags,
  checklistProgress,
  describeQuery,
  EMPTY_QUERY,
  isEmptyQuery,
  type TaskQuery,
  type When,
} from '@orvyn/today-plan';
import {
  Bookmark,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  EllipsisVertical,
  Flag,
  Folder,
  FolderOpen,
  ListChecks,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Label, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { localDay, taskDay, taskMoment, useToday } from '@/lib/today';
import { dayWords, deadlineTone, hm } from '@/lib/work';
import { FactPill, usePick } from './pick';
import { ScheduleStrip } from './schedule';

const sel =
  'h-9 rounded-orv-md border border-orv-edge bg-orv-glass px-2 text-[13px] text-orv-text outline-none';

export const colourOf = (p?: Project | null) => `var(--orv-label-${p?.colour ?? 'slate'})`;

/** Search, filters and saved filters for the task list (one place for web and the board). */
export function TaskToolbar({
  query,
  setQuery,
  tasks,
  projects,
  selecting,
  setSelecting,
}: {
  query: TaskQuery;
  setQuery(q: TaskQuery): void;
  tasks: Task[];
  projects: Project[];
  selecting: boolean;
  setSelecting(v: boolean): void;
}) {
  const { filters, saveFilter, removeFilter } = useToday();
  const toast = useToast();
  const tags = useMemo(() => allTags(tasks), [tasks]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const set = (p: Partial<TaskQuery>) => setQuery({ ...query, ...p });
  const name_ = (id: string) => projects.find((p) => p.id === id)?.name;
  const active = filters.find(
    (f) =>
      f.text === query.text &&
      f.projectId === query.projectId &&
      f.tag === query.tag &&
      f.minPriority === query.minPriority &&
      f.when === query.when,
  );
  return (
    <div className="flex flex-col gap-2" role="search" aria-label="Filter tasks">
      <div className="flex flex-wrap items-center gap-2">
        <label className="field-ring flex h-9 min-w-44 flex-1 items-center gap-2 rounded-orv-md px-2">
          <Search size={14} className="text-orv-faint" aria-hidden />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks, notes, tags"
            value={query.text}
            onChange={(e) => set({ text: e.target.value })}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-orv-faint"
          />
        </label>
        <select
          aria-label="List filter"
          className={sel}
          value={query.projectId ?? ''}
          onChange={(e) => set({ projectId: e.target.value || null })}
        >
          <option value="">All projects</option>
          <option value="none">No project</option>
          {projects
            .filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        {tags.length ? (
          <select
            aria-label="Tag filter"
            className={sel}
            value={query.tag ?? ''}
            onChange={(e) => set({ tag: e.target.value || null })}
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Priority filter"
          className={sel}
          value={query.minPriority}
          onChange={(e) => set({ minPriority: Number(e.target.value) })}
        >
          <option value={0}>Any priority</option>
          <option value={1}>Low and up</option>
          <option value={2}>Medium and up</option>
          <option value={3}>High only</option>
        </select>
        <select
          aria-label="When filter"
          className={sel}
          value={query.when}
          onChange={(e) => set({ when: e.target.value as When })}
        >
          <option value="any">Any time</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="week">Next 7 days</option>
          <option value="later">Later</option>
          <option value="none">No date</option>
        </select>
        <Button
          size="sm"
          variant={selecting ? 'secondary' : 'ghost'}
          aria-pressed={selecting}
          onClick={() => setSelecting(!selecting)}
        >
          <ListChecks size={14} /> Select
        </Button>
      </div>

      {!isEmptyQuery(query) && !active ? (
        naming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void saveFilter(null, { ...query, name: name.trim(), order: filters.length }).then(() => {
                toast({ title: 'Filter saved', body: name.trim(), tone: 'success' });
                setNaming(false);
                setName('');
              });
            }}
          >
            <Input
              aria-label="Filter name"
              autoFocus
              placeholder="Name this filter"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="h-9 max-w-64 text-[13px]"
            />
            <Button size="sm" type="submit" variant="primary" disabled={!name.trim()}>
              Save
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-orv-muted">
            <span>{describeQuery(query, name_)}</span>
            <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
              <Bookmark size={13} /> Save this filter
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setQuery(EMPTY_QUERY)}>
              Clear
            </Button>
          </div>
        )
      ) : null}

      {filters.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved filters">
          {filters.map((f) => (
            <span
              key={f.id}
              className={cn(
                'inline-flex items-center rounded-full border text-[13px]',
                active?.id === f.id ? 'border-orv-accent bg-orv-track' : 'border-orv-edge',
              )}
            >
              <button
                className="px-3 py-1"
                aria-pressed={active?.id === f.id}
                title={describeQuery(f, name_)}
                onClick={() => setQuery(active?.id === f.id ? EMPTY_QUERY : toQuery(f))}
              >
                {f.name}
              </button>
              <button
                aria-label={`Delete filter ${f.name}`}
                className="pr-2 text-orv-faint hover:text-orv-danger"
                onClick={() => void removeFilter(f.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const toQuery = (f: SavedFilter): TaskQuery => ({
  text: f.text,
  projectId: f.projectId,
  tag: f.tag,
  minPriority: f.minPriority,
  when: f.when as When,
});

/** The floating bar while selecting (spec 0012 A7): Done · When · Project · Priority · Delete. */
export function SelectBar({
  picked,
  clear,
  projects,
}: {
  picked: Task[];
  clear(): void;
  projects: Project[];
}) {
  const { updateTask, removeTask } = useToday();
  const toast = useToast();
  const { ask, picker } = usePick();
  const none = !picked.length;
  const each = async (fn: (t: Task) => Promise<void>, said: string) => {
    const n = picked.length;
    for (const t of picked) await fn(t);
    toast({ title: `${said} ${n}`, tone: 'success' });
    clear();
  };
  const act = (icon: React.ReactNode, label: string, run: () => void, tone?: string) => (
    <button
      type="button"
      disabled={none}
      onClick={run}
      className="flex min-w-16 flex-col items-center gap-0.5 rounded-orv-md px-2 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-orv-track disabled:opacity-40"
      style={tone ? { color: tone } : undefined}
    >
      {icon}
      {label}
    </button>
  );
  const now = new Date();
  const plus = (n: number) => localDay(new Date(now.getTime() + n * 86_400_000));
  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={spring.smooth}
      role="toolbar"
      aria-label="Selected tasks"
      className="glass-float fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-lg items-center justify-around p-1.5 md:bottom-6"
    >
      {act(
        <Check size={18} />,
        'Done',
        () => void each((t) => updateTask(t.id, { completedAt: new Date().toISOString() }), 'Done:'),
        'var(--orv-accent)',
      )}
      {act(<CalendarDays size={18} />, 'When', async () => {
        const v = await ask<string>(`Move ${picked.length} to…`, [
          { value: plus(0), label: 'Today' },
          { value: plus(1), label: 'Tomorrow' },
          { value: plus(7), label: 'In a week' },
          { value: '', label: 'No day (Inbox)' },
        ]);
        if (v !== null)
          await each(
            (t) => updateTask(t.id, { dueDate: v || null, dueAt: null, scheduledStart: null }),
            'Moved',
          );
      })}
      {act(<Folder size={18} />, 'Project', async () => {
        const v = await ask<string>('Move to project', [
          ...projects.map((p) => ({ value: p.id, label: p.name, colour: colourOf(p) })),
          { value: '', label: 'No project' },
        ]);
        if (v !== null) await each((t) => updateTask(t.id, { projectId: v || null }), 'Moved');
      })}
      {act(<Flag size={18} />, 'Priority', async () => {
        const v = await ask<number>('Priority', [
          { value: 3, label: 'High', colour: 'var(--orv-danger)' },
          { value: 2, label: 'Medium', colour: 'var(--orv-warning)' },
          { value: 1, label: 'Low', colour: 'var(--orv-faint)' },
          { value: 0, label: 'None' },
        ]);
        if (v !== null) await each((t) => updateTask(t.id, { priority: v }), 'Updated');
      })}
      {act(
        <Trash2 size={18} />,
        'Delete',
        () => {
          if (confirm(`Delete ${picked.length} ${picked.length === 1 ? 'task' : 'tasks'}?`))
            void each((t) => removeTask(t.id), 'Deleted');
        },
        'var(--orv-danger)',
      )}
      {picker}
    </motion.div>
  );
}

const COLUMNS = [
  { key: 'todo', name: 'To do', icon: <Circle size={14} aria-hidden />, tone: 'var(--orv-muted)' },
  { key: 'doing', name: 'Doing', icon: <CircleDashed size={14} aria-hidden />, tone: 'var(--orv-accent)' },
  {
    key: 'done',
    name: 'Done today',
    icon: <CircleCheck size={14} aria-hidden />,
    tone: 'var(--orv-success)',
  },
] as const;
type Col = (typeof COLUMNS)[number]['key'];

/** The board (spec 0012 A8): To do · Doing · Done today, a project pill, drag a card to another column. */
export function Board({
  tasks,
  projects,
  onOpen,
}: {
  tasks: Task[];
  projects: Project[];
  onOpen(t: Task): void;
}) {
  const { updateTask } = useToday();
  const toast = useToast();
  const { ask, picker } = usePick();
  const [project, setProject] = useState<string | null>(null); // null all, '' none
  const [over, setOver] = useState<Col | null>(null);
  const today = localDay(new Date());
  const shown = tasks.filter((t) => project === null || (t.projectId ?? '') === project);
  const col = (k: Col) =>
    (k === 'done'
      ? shown.filter((t) => t.completedAt && localDay(new Date(t.completedAt)) === today)
      : shown.filter((t) => !t.completedAt && (t.status ?? 'todo') === k)
    ).sort((a, b) =>
      k === 'done'
        ? (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
        : (taskDay(a) ?? '9999').localeCompare(taskDay(b) ?? '9999') ||
          (taskMoment(a) ?? Infinity) - (taskMoment(b) ?? Infinity) ||
          b.priority - a.priority,
    );
  const move = async (t: Task, k: Col) => {
    if (k === 'done') {
      if (!t.completedAt) await updateTask(t.id, { completedAt: new Date().toISOString() });
    } else await updateTask(t.id, { status: k, ...(t.completedAt ? { completedAt: null } : {}) });
    toast({ title: `Moved to ${COLUMNS.find((c) => c.key === k)!.name}`, body: t.title, tone: 'success' });
  };
  const current = projects.find((p) => p.id === project);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FactPill
          icon={<FolderOpen size={13} />}
          label={project === null ? 'All projects' : (current?.name ?? 'No project')}
          tone={current ? colourOf(current) : undefined}
          onClick={async () => {
            const v = await ask<string>('Show on the board', [
              { value: '*', label: 'All projects', selected: project === null },
              ...projects.map((p) => ({
                value: p.id,
                label: p.name,
                colour: colourOf(p),
                selected: project === p.id,
              })),
              { value: '', label: 'No project', selected: project === '' },
            ]);
            if (v !== null) setProject(v === '*' ? null : v);
          }}
        />
        <span className="text-[12px] text-orv-faint">Drag a card to move it</span>
      </div>
      <ScheduleStrip />
      <div className="grid snap-x grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((c) => {
          const items = col(c.key);
          return (
            <section
              key={c.key}
              aria-label={`${c.name}, ${items.length} tasks`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(c.key);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const id = e.dataTransfer.getData('application/x-orvyn-card');
                const t = tasks.find((x) => x.id === id);
                if (t) void move(t, c.key);
              }}
              className={cn('glass-pane flex min-h-72 snap-start flex-col gap-2 p-3 transition-shadow')}
              style={over === c.key ? { boxShadow: `0 0 0 2px ${c.tone}`, borderColor: c.tone } : undefined}
            >
              <div className="flex items-center gap-2 px-1" style={{ color: c.tone }}>
                {c.icon}
                <Label className="!text-current">{c.name}</Label>
                <span className="text-[12px] text-orv-muted">{items.length}</span>
              </div>
              {items.map((t) => (
                <BoardCard
                  key={t.id}
                  task={t}
                  project={project === null ? projects.find((p) => p.id === t.projectId) : undefined}
                  onOpen={onOpen}
                  column={c.key}
                  onMove={(k) => void move(t, k)}
                />
              ))}
              {!items.length ? (
                <p className="px-1 py-6 text-center text-small text-orv-muted">
                  {c.key === 'doing'
                    ? 'Drop what you’re on here.'
                    : c.key === 'done'
                      ? 'Nothing finished today yet.'
                      : 'All clear.'}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
      {picker}
    </div>
  );
}

function BoardCard({
  task,
  project,
  onOpen,
  column,
  onMove,
}: {
  task: Task;
  project?: Project;
  onOpen(t: Task): void;
  column: Col;
  onMove(k: Col): void;
}) {
  const [menu, setMenu] = useState(false);
  const prog = checklistProgress(task);
  const day = taskDay(task);
  const today = localDay(new Date());
  const dl = deadlineTone(task.deadline);
  const moment = taskMoment(task);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-orvyn-card', task.id)}
      className="group relative cursor-grab rounded-[12px] border border-orv-edge bg-orv-field p-3 transition-shadow hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] active:cursor-grabbing"
      style={{ borderLeft: `3px solid ${project ? colourOf(project) : 'var(--orv-edge)'}` }}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex w-full flex-col items-start gap-1 text-left"
      >
        <span
          className={cn(
            'line-clamp-3 pr-6 text-[14px] font-semibold',
            task.completedAt && 'text-orv-muted line-through',
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-orv-muted">
          {task.completedAt ? (
            <span className="text-orv-success">
              {doneLabel(task.completedAt, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </span>
          ) : moment ? (
            <span className={cn(moment < Date.now() && 'text-orv-danger')}>
              {day !== today && day ? `${dayWords(day)}, ` : ''}
              {new Date(moment).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          ) : day ? (
            <span className={cn(day < today && 'text-orv-danger')}>{dayWords(day)}</span>
          ) : null}
          {task.durationMin ? <span>{hm(task.durationMin)}</span> : null}
          {task.deadline && !task.completedAt ? (
            <span className={cn(dl === 'past' ? 'text-orv-danger' : dl === 'near' ? 'text-orv-warning' : '')}>
              by {dayWords(task.deadline)}
            </span>
          ) : null}
          {prog.total ? (
            <span>
              {prog.done}/{prog.total}
            </span>
          ) : null}
          {project ? <span style={{ color: colourOf(project) }}>{project.name}</span> : null}
          {task.priority >= 2 ? <PriorityFlag p={task.priority} /> : null}
        </span>
      </button>
      <button
        type="button"
        aria-label="Move to"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
        className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full text-orv-faint opacity-0 transition-opacity hover:bg-orv-track group-hover:opacity-100 focus:opacity-100"
      >
        <EllipsisVertical size={14} />
      </button>
      {menu ? (
        <div
          role="menu"
          className="glass-float absolute right-1 top-9 z-20 flex w-44 flex-col p-1"
          onMouseLeave={() => setMenu(false)}
        >
          {COLUMNS.filter((c) => c.key !== column).map((c) => (
            <button
              key={c.key}
              role="menuitem"
              className="rounded-orv-sm px-3 py-2 text-left text-[13.5px] hover:bg-orv-track"
              onClick={() => {
                setMenu(false);
                onMove(c.key);
              }}
            >
              Move to {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PriorityFlag({ p }: { p: number }) {
  return (
    <Flag
      size={13}
      aria-label={['', 'Low priority', 'Medium priority', 'High priority'][p]}
      className={p === 3 ? 'text-orv-danger' : p === 2 ? 'text-orv-warning' : 'text-orv-faint'}
    />
  );
}

/** Tags as chips with an input: Enter, comma or space adds one. */
export function TagsInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange(t: string[]): void;
  suggestions: string[];
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').slice(0, 40);
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase()) && value.length < 20)
      onChange([...value, t]);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-orv-md field-ring p-2">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-orv-track px-2 py-0.5 text-[12px]"
          >
            #{t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          aria-label="Add tag"
          value={text}
          placeholder={value.length ? '' : 'Add a tag'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => add(text)}
          className="min-w-24 flex-1 bg-transparent text-[14px] outline-none"
        />
      </div>
      {suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).length ? (
        <div className="flex flex-wrap gap-1">
          {suggestions
            .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
            .slice(0, 6)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-full border border-orv-edge px-2 py-0.5 text-[12px] text-orv-muted hover:bg-orv-track"
              >
                +#{s}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/** A checklist inside a task, with progress. */
export function ChecklistEditor({
  value,
  onChange,
}: {
  value: Task['checklist'];
  onChange(v: Task['checklist']): void;
}) {
  const [text, setText] = useState('');
  const done = value.filter((c) => c.done).length;
  return (
    <div className="flex flex-col gap-2" aria-label="Checklist">
      {value.length ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-orv-track">
            <div
              className="h-full rounded-full [background:var(--orv-accent-grad)] transition-[width]"
              style={{ width: `${(done / value.length) * 100}%` }}
            />
          </div>
          <span className="text-[12px] tabular-nums text-orv-muted">
            {done}/{value.length}
          </span>
        </div>
      ) : null}
      {value.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Done: ${c.text}`}
            checked={c.done}
            onChange={() => onChange(value.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
          />
          <input
            aria-label={`Step ${i + 1}`}
            value={c.text}
            maxLength={300}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            className={cn(
              'flex-1 bg-transparent text-[14px] outline-none',
              c.done && 'text-orv-muted line-through',
            )}
          />
          <button
            type="button"
            aria-label={`Remove step ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={13} className="text-orv-faint" />
          </button>
        </div>
      ))}
      <input
        aria-label="Add a step"
        value={text}
        placeholder="Add a step"
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const t = text.trim();
            if (t && value.length < 100)
              onChange([...value, { id: crypto.randomUUID().slice(0, 8), text: t, done: false }]);
            setText('');
          }
        }}
        className="h-9 rounded-orv-md field-ring px-3 text-[14px] outline-none"
      />
    </div>
  );
}
