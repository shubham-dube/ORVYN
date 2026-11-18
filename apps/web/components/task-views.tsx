'use client';

import type { Project, SavedFilter, Task } from '@orvyn/contracts';
import { PROJECT_COLOURS } from '@orvyn/contracts';
import {
  allTags,
  checklistProgress,
  describeQuery,
  EMPTY_QUERY,
  isEmptyQuery,
  type TaskQuery,
  type When,
} from '@orvyn/today-plan';
import { Bookmark, Check, Flag, ListChecks, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Glass, Label, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { localDay, taskMoment, useToday } from '@/lib/today';

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
        <label className="flex h-9 min-w-44 flex-1 items-center gap-2 rounded-orv-md border border-orv-edge bg-orv-glass px-2">
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

/** What can be done to the ticked tasks in one go. */
export function BulkBar({ picked, clear, projects }: { picked: Task[]; clear(): void; projects: Project[] }) {
  const { updateTask, removeTask } = useToday();
  const toast = useToast();
  const [day, setDay] = useState('');
  const each = async (fn: (t: Task) => Promise<void>) => {
    for (const t of picked) await fn(t);
  };
  if (!picked.length) return null;
  return (
    <Glass
      level="float"
      className="sticky bottom-20 z-10 flex flex-wrap items-center gap-2 p-3"
      aria-label="Bulk actions"
    >
      <span className="px-1 text-[13px] font-medium">{picked.length} selected</span>
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          await each((t) => updateTask(t.id, { completedAt: new Date().toISOString() }));
          toast({ title: `${picked.length} done`, tone: 'success' });
          clear();
        }}
      >
        <Check size={14} /> Complete
      </Button>
      <select
        aria-label="Move to project"
        className={sel}
        value=""
        onChange={async (e) => {
          const v = e.target.value;
          if (!v) return;
          await each((t) => updateTask(t.id, { projectId: v === 'none' ? null : v }));
          toast({ title: `Moved ${picked.length}`, tone: 'success' });
          clear();
        }}
      >
        <option value="">Move to…</option>
        <option value="none">No project</option>
        {projects
          .filter((p) => !p.archived)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <Input
        aria-label="Set day for selected"
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className="h-9 w-40 text-[13px]"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!day}
        onClick={async () => {
          await each((t) => updateTask(t.id, { dueDate: day, dueAt: null, scheduledStart: null }));
          toast({ title: `Planned ${picked.length} for ${day}`, tone: 'success' });
          setDay('');
          clear();
        }}
      >
        Set day
      </Button>
      <select
        aria-label="Set priority for selected"
        className={sel}
        value=""
        onChange={async (e) => {
          if (e.target.value === '') return;
          await each((t) => updateTask(t.id, { priority: Number(e.target.value) }));
          clear();
        }}
      >
        <option value="">Priority…</option>
        <option value={0}>None</option>
        <option value={1}>Low</option>
        <option value={2}>Medium</option>
        <option value={3}>High</option>
      </select>
      <Button
        size="sm"
        variant="danger"
        onClick={async () => {
          const n = picked.length;
          await each((t) => removeTask(t.id));
          toast({ title: `Deleted ${n}` });
          clear();
        }}
      >
        <Trash2 size={14} /> Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={clear}>
        Cancel
      </Button>
    </Glass>
  );
}

/** Tasks as columns by project; drag a card to another column to move it. */
export function Board({
  tasks,
  projects,
  onOpen,
}: {
  tasks: Task[];
  projects: Project[];
  onOpen(t: Task): void;
}) {
  const { updateTask, addProject } = useToday();
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const columns = [
    { id: 'none', name: 'No project', project: null as Project | null },
    ...projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, project: p })),
  ];
  const open = tasks.filter((t) => !t.completedAt);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Board">
        {columns.map((c) => {
          const items = open
            .filter((t) => (c.id === 'none' ? t.projectId === null : t.projectId === c.id))
            .sort(
              (a, b) => (taskMoment(a) ?? Infinity) - (taskMoment(b) ?? Infinity) || b.priority - a.priority,
            );
          return (
            <section
              key={c.id}
              role="listitem"
              aria-label={`${c.name}, ${items.length} tasks`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(c.id);
              }}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/task');
                if (id) void updateTask(id, { projectId: c.id === 'none' ? null : c.id });
              }}
              className={cn(
                'glass-pane flex w-72 shrink-0 flex-col gap-2 p-3 transition-shadow',
                over === c.id && 'shadow-[0_0_0_2px_var(--orv-accent)]',
              )}
            >
              <header className="flex items-center gap-2 px-1">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: colourOf(c.project) }}
                  aria-hidden
                />
                <Label>{c.name}</Label>
                <span className="text-[12px] text-orv-muted">{items.length}</span>
              </header>
              {items.map((t) => (
                <BoardCard key={t.id} task={t} onOpen={onOpen} />
              ))}
              {!items.length ? <p className="px-1 py-3 text-[12px] text-orv-faint">Nothing here.</p> : null}
            </section>
          );
        })}
        <form
          className="flex w-60 shrink-0 flex-col gap-2 self-start p-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = adding.trim();
            if (!n) return;
            const colour = PROJECT_COLOURS[projects.length % PROJECT_COLOURS.length];
            void addProject(n, colour).then(() => setAdding(''));
          }}
        >
          <Input
            aria-label="New project"
            placeholder="New project"
            value={adding}
            maxLength={80}
            onChange={(e) => setAdding(e.target.value)}
            className="h-10 text-[14px]"
          />
          <Button size="sm" type="submit" variant="secondary" disabled={!adding.trim()}>
            <Plus size={14} /> Add project
          </Button>
        </form>
      </div>
    </div>
  );
}

function BoardCard({ task, onOpen }: { task: Task; onOpen(t: Task): void }) {
  const { projects } = useToday();
  void projects;
  const prog = checklistProgress(task);
  const moment = taskMoment(task);
  const day = task.dueDate ?? (moment ? localDay(new Date(moment)) : null);
  return (
    <button
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/task', task.id)}
      onClick={() => onOpen(task)}
      className="flex flex-col gap-1.5 rounded-orv-md border border-orv-edge bg-orv-field p-3 text-left hover:border-orv-accent"
    >
      <span className="text-[14px] font-medium">{task.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-orv-muted">
        {day ? (
          <span>
            {new Date(`${day}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        ) : null}
        {task.priority ? <PriorityFlag p={task.priority} /> : null}
        {prog.total ? (
          <span>
            {prog.done}/{prog.total}
          </span>
        ) : null}
        {task.tags.slice(0, 3).map((t) => (
          <Badge key={t}>#{t}</Badge>
        ))}
      </span>
    </button>
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
      <div className="flex flex-wrap items-center gap-1.5 rounded-orv-md border border-orv-edge bg-orv-field p-2">
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
        className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px] outline-none"
      />
    </div>
  );
}
