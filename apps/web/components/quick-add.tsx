'use client';

import { looksUnread, type Parsed } from '@orvyn/today-parse';
import { ArrowUp, CalendarDays, CornerDownLeft, Inbox, Info, Maximize2, Plus, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { Glass, Sheet, useToast } from '@/components/ui/bits';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { smartParse, taskFields } from '@/lib/smart-task';
import { localDay, useToday } from '@/lib/today';
import { dayWords } from '@/lib/work';
import { TaskChips } from './task-chips';
import type { NewTask } from './task-sheet';

/**
 * Quick add (spec 0012 A4/A5): type it the way you'd say it. What ORVYN understood shows as chips (× reads it
 * literally); no day written → the Inbox, shown as a faint chip with a day picker. ⤢ (or Shift+Enter) opens the
 * full form with everything carried over.
 */
export function QuickAdd({ onExpand }: { onExpand(t: NewTask): void }) {
  const { addTask, addProject, projects, settings } = useToday();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [focused, setFocused] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [tips, setTips] = useState(false);
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
  const hasDay = !!(parsed?.dueAt || parsed?.dueDate || day);

  const fieldsOf = (p: Parsed): NewTask => {
    const f = taskFields(p);
    if (day) {
      if (p.dueAt) {
        const t = new Date(p.dueAt).toTimeString().slice(0, 5);
        f.dueAt = new Date(`${day}T${t}`).toISOString();
      } else {
        f.dueDate = day;
      }
    }
    return { ...f, _newProject: p.projectName };
  };

  const reset = () => {
    setTitle('');
    setLiteral([]);
    setDay(null);
  };

  const submit = async () => {
    if (!parsed) return;
    let read: Parsed = parsed;
    if (looksUnread(parsed) && navigator.onLine) {
      read = await api<Parsed>('/today/parse', {
        method: 'POST',
        body: { text: title, ai: true, literal: JSON.parse(liveKey) as [number, number][] },
      }).catch(() => parsed);
    }
    const { _newProject, ...f } = fieldsOf(read);
    if (_newProject) f.projectId = await addProject(_newProject);
    await addTask({ ...f, source: 'typed' });
    const when = f.dueAt ? localDay(new Date(f.dueAt)) : f.dueDate;
    toast({
      title: when ? `Added for ${dayWords(when).toLowerCase()}` : 'In your Inbox',
      body: f.title,
      tone: 'success',
    });
    reset();
    input.current?.focus();
  };

  const expand = () => {
    onExpand(parsed ? fieldsOf(parsed) : { title: title.trim() });
    reset();
  };

  return (
    <Glass
      level="float"
      className={cn(
        'flex flex-col gap-2 p-2.5 transition-[box-shadow,border-color]',
        focused &&
          '!border-orv-accent shadow-[0_0_0_3.5px_color-mix(in_srgb,var(--orv-accent)_22%,transparent)]',
      )}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="ml-1.5 text-orv-accent" aria-hidden>
          {title ? <Sparkles size={18} /> : <Plus size={18} />}
        </span>
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              expand();
            }
          }}
          placeholder="Add a task…  “call mom tmr 6pm for 15m !!”"
          aria-label="New task"
          maxLength={500}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-orv-faint"
        />
        {!title ? (
          <button
            type="button"
            aria-label="How to write it"
            onClick={() => setTips(true)}
            className="grid size-9 place-items-center rounded-full text-orv-faint hover:bg-orv-track hover:text-orv-text"
          >
            <Info size={17} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={title ? 'Open the full form (Shift+Enter)' : 'New task with all the details'}
          onClick={expand}
          className="grid size-9 place-items-center rounded-full text-orv-muted hover:bg-orv-track hover:text-orv-text"
        >
          <Maximize2 size={16} />
        </button>
        <AnimatePresence>
          {title.trim() ? (
            <motion.button
              type="submit"
              aria-label="Add task"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={spring.snappy}
              className="grid size-9 place-items-center rounded-full text-white shadow-[0_6px_16px_color-mix(in_srgb,var(--orv-accent-from)_40%,transparent)] [background:var(--orv-accent-grad)]"
            >
              <ArrowUp size={17} />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </form>
      {title.trim() ? (
        <div className="flex flex-wrap items-center gap-2 pl-8 pr-1">
          {parsed?.spans.length && parsed.title !== title.trim() ? (
            <span className="text-[12px] font-semibold">{parsed.title}</span>
          ) : null}
          <TaskChips
            parsed={parsed}
            projects={projects}
            onRemove={(range, text) => setLiteral((l) => [...l, { range, text }])}
          />
          {day ? (
            <span className="flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--orv-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] py-0.5 pl-2 pr-1 text-[12px] font-semibold text-orv-accent">
              <CalendarDays size={12} aria-hidden /> {dayWords(day)}
              <button
                type="button"
                aria-label="Clear the day"
                onClick={() => setDay(null)}
                className="rounded-full px-1 hover:bg-orv-track"
              >
                ×
              </button>
            </span>
          ) : null}
          {!hasDay ? (
            <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-full border border-orv-edge px-2 py-0.5 text-[12px] text-orv-faint hover:border-orv-accent hover:text-orv-text">
              <Inbox size={12} aria-hidden /> Inbox · pick a day
              <input
                type="date"
                aria-label="Pick a day"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => setDay(e.target.value || null)}
              />
            </label>
          ) : null}
        </div>
      ) : focused ? (
        <p className="pl-8 text-[12px] text-orv-faint">
          when · time · for 30m · !! · @project · #tag · by fri · // notes
        </p>
      ) : null}
      <QuickAddTips
        open={tips}
        onClose={() => setTips(false)}
        onUse={(s) => {
          setTitle(s);
          setTips(false);
          setTimeout(() => input.current?.focus(), 50);
        }}
      />
    </Glass>
  );
}

const ROWS: [string, string][] = [
  ['When', 'today · tmr · fri · next mon · 22 nov · in 3 days · kal · parso'],
  ['Time', '3pm · 3 PM · 3:30pm · 15:00 · at 6 · shaam 6 baje'],
  ['Duration', 'for 45m · 1h · 1h30 · 1.5h — or a range: 3-4pm'],
  ['Priority', '! low · !! medium · !!! high · p1 · urgent'],
  ['Project', '@work (a new name offers to make it)'],
  ['Tags', '#design #frontend'],
  ['Deadline', 'by fri · due 30 nov · deadline mon'],
  ['Repeat', 'every day · weekdays · every mon · every 1st'],
  ['Notes', 'everything after //'],
];
const EXAMPLES = [
  'call mom tmr 6pm for 15m !! @home // ask about the trip',
  'review PR fri 3-4pm @work #frontend by mon',
  'pay rent every 1st !',
];

export function QuickAddTips({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose(): void;
  onUse(s: string): void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Write it the way you say it"
      subtitle="No day written → it waits in your Inbox. Tap a chip’s × to read those words literally."
    >
      <div className="flex flex-col gap-4">
        <code className="rounded-orv-md bg-orv-field p-3 font-mono text-[12.5px]">
          what when time [for 30m] [!!] [@project] [#tag] [by fri] [// notes]
        </code>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-[14px]">
          {ROWS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{k}</dt>
              <dd className="text-orv-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onUse(e)}
              className="flex items-center gap-2 rounded-orv-md border border-orv-edge px-3 py-2 text-left font-mono text-[12.5px] hover:border-orv-accent"
            >
              <span className="flex-1">{e}</span>
              <CornerDownLeft size={14} className="text-orv-faint" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
