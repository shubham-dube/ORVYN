'use client';

import {
  type CalEvent,
  eventProblem,
  type Task,
  type TodaySettingsFields,
  workingRangesOn,
} from '@orvyn/contracts';
import { describeRepeat, expandEvents, type Instance, type Plan, planFromRecords } from '@orvyn/today-plan';
import { CalendarPlus, ChevronLeft, ChevronRight, GripVertical, Sparkles, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import {
  atLocal,
  type Block,
  durationLabel,
  freeRanges,
  HOUR_PX,
  hhmm,
  layout,
  minutesOf,
  monthGrid,
  repeatPresets,
  shiftDay,
  snapAt,
  taskBlocks,
  weekOf,
} from '@/lib/calendar';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { localDay, taskDay, useToday } from '@/lib/today';

type View = 'day' | 'week' | 'month';
const DRAG_TASK = 'application/x-orvyn-task';
const DRAG_EVENT = 'application/x-orvyn-event';

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const labelColour = (colour?: string | null) => `var(--orv-label-${colour ?? 'sky'})`;
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayTitle = (day: string, opts: Intl.DateTimeFormatOptions) =>
  atLocal(day, 0).toLocaleDateString(undefined, opts);

/** Instances overlapping a range of local days, with hidden calendars left out. */
function useInstances(fromDay: string, toDayExclusive: string): Instance[] {
  const { events, calendars } = useToday();
  return useMemo(() => {
    const hidden = new Set(calendars.filter((c) => !c.visible).map((c) => c.id));
    return expandEvents(events, atLocal(fromDay, 0), atLocal(toDayExclusive, 0), hidden);
  }, [events, calendars, fromDay, toDayExclusive]);
}

/** What an instance covers on one local day, in minutes from midnight (null when it doesn't touch it). */
function onDay(i: Instance, day: string): { start: number; end: number } | null {
  if (i.allDay) return null;
  const s = new Date(i.start!);
  const e = new Date(i.end!);
  const d0 = atLocal(day, 0).getTime();
  const d1 = atLocal(shiftDay(day, 1), 0).getTime();
  if (e.getTime() <= d0 || s.getTime() >= d1) return null;
  return {
    start: s.getTime() <= d0 ? 0 : minutesOf(s),
    end: e.getTime() >= d1 ? 24 * 60 : Math.max(minutesOf(e), minutesOf(s) + 15),
  };
}
const allDayOn = (i: Instance, day: string) => i.allDay && i.startDate! <= day && i.endDate! > day;

// ================================================================== the switcher

export function CalendarViews({ onOpenTask }: { onOpenTask(t: Task): void }) {
  const { settings } = useToday();
  const [view, setView] = useState<View>('day');
  const [day, setDay] = useState(() => localDay(new Date()));
  const [editing, setEditing] = useState<EventDraft | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const today = localDay(new Date());
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0;
  const move = (dir: number) => {
    if (step) return setDay(shiftDay(day, dir * step));
    const [y, m] = day.split('-').map(Number) as [number, number];
    setDay(localDay(new Date(y, m - 1 + dir, 1)));
  };
  const title =
    view === 'month'
      ? dayTitle(day, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `Week of ${dayTitle(weekOf(day)[0]!, { day: 'numeric', month: 'short' })}`
        : dayTitle(day, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section aria-label="Calendar" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Calendar view"
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => move(-1)}>
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant={day === today ? 'secondary' : 'ghost'} onClick={() => setDay(today)}>
            Today
          </Button>
          <Button size="sm" variant="ghost" aria-label="Next" onClick={() => move(1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <h2 className="text-[15px] font-semibold" aria-live="polite">
          {title}
        </h2>
        <div className="ml-auto flex gap-2">
          {view === 'day' ? <PlanButton day={day} onPlan={setPlan} /> : null}
          <Button size="sm" variant="secondary" onClick={() => setEditing(newDraft(day, 10 * 60, settings))}>
            <CalendarPlus size={14} /> Event
          </Button>
        </div>
      </div>

      {view === 'day' ? (
        <DayRiver day={day} onOpenTask={onOpenTask} onEdit={setEditing} />
      ) : view === 'week' ? (
        <WeekView
          day={day}
          onOpenTask={onOpenTask}
          onEdit={setEditing}
          onPickDay={(d) => {
            setDay(d);
            setView('day');
          }}
        />
      ) : (
        <MonthView
          day={day}
          onPickDay={(d) => {
            setDay(d);
            setView('day');
          }}
        />
      )}

      <EventSheet draft={editing} onClose={() => setEditing(null)} />
      <PlanSheet plan={plan} onClose={() => setPlan(null)} />
    </section>
  );
}

// ================================================================== the Time River (one day)

function DayRiver({
  day,
  onOpenTask,
  onEdit,
}: {
  day: string;
  onOpenTask(t: Task): void;
  onEdit(d: EventDraft): void;
}) {
  const { tasks, events, calendars, settings, updateTask, updateEvent } = useToday();
  const toast = useToast();
  const instances = useInstances(day, shiftDay(day, 1));
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const isToday = localDay(now) === day;
  const working = settings ? workingRangesOn(settings, day) : [];
  const colourOf = (calendarId: string | null) => calendars.find((c) => c.id === calendarId)?.colour ?? 'sky';

  const blocks = useMemo(() => {
    const ev: Block[] = instances.flatMap((i) => {
      const span = onDay(i, day);
      return span
        ? [
            {
              key: `e-${i.eventId}-${i.occurrence ?? ''}`,
              kind: 'event' as const,
              id: i.eventId,
              title: i.title,
              ...span,
              colour: colourOf(i.calendarId),
            },
          ]
        : [];
    });
    return layout([...ev, ...taskBlocks(tasks, day)]);
  }, [instances, tasks, day, calendars]);
  const allDay = instances.filter((i) => allDayOn(i, day));
  const free = freeRanges(
    working,
    blocks,
    isToday ? Math.ceil(minutesOf(now) / 5) * 5 : day < localDay(now) ? 24 * 60 : 0,
  );
  const unplaced = tasks.filter((t) => {
    if (t.completedAt || t.scheduledStart || t.dueAt) return false;
    const d = taskDay(t);
    return d !== null && d <= day;
  });

  // open near the start of the working day (or now)
  useEffect(() => {
    const first = isToday
      ? minutesOf(new Date()) - 60
      : working[0]
        ? Number(working[0].start.slice(0, 2)) * 60 - 60
        : 8 * 60;
    scroller.current?.scrollTo({ top: Math.max(0, (first / 60) * HOUR_PX) });
  }, [day]);

  const minutesAt = (e: DragEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return snapAt(e.clientY - r.top);
  };
  const drop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(null);
    const start = atLocal(day, minutesAt(e));
    const taskId = e.dataTransfer.getData(DRAG_TASK);
    if (taskId) {
      const t = tasks.find((x) => x.id === taskId);
      if (!t) return;
      await updateTask(taskId, {
        scheduledStart: start.toISOString(),
        durationMin: t.durationMin ?? 30,
        // a date-only task placed on another day moves to that day
        ...(t.dueDate && !t.dueAt ? { dueDate: day } : {}),
      });
      toast({ title: `${t.title} · ${timeLabel(start)}`, tone: 'success' });
      return;
    }
    const eventId = e.dataTransfer.getData(DRAG_EVENT);
    const ev = events.find((x) => x.id === eventId);
    if (ev && !ev.rrule && ev.start && ev.end) {
      const len = Date.parse(ev.end) - Date.parse(ev.start);
      await updateEvent(ev.id, {
        start: start.toISOString(),
        end: new Date(start.getTime() + len).toISOString(),
      });
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <Glass className="overflow-hidden p-0">
        {allDay.length ? (
          <div className="flex flex-wrap gap-1.5 border-b border-orv-edge px-3 py-2" aria-label="All day">
            {allDay.map((i) => (
              <button
                key={`${i.eventId}-${i.occurrence ?? ''}`}
                onClick={() => onEdit(draftFrom(events, i))}
                className="rounded-orv-sm px-2 py-0.5 text-[12px] font-medium"
                style={{
                  color: labelColour(colourOf(i.calendarId)),
                  background: `color-mix(in srgb, ${labelColour(colourOf(i.calendarId))} 14%, transparent)`,
                }}
              >
                {i.title}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={scroller} className="relative max-h-[640px] overflow-y-auto">
          <div className="relative ml-14 mr-2" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                aria-hidden
                className="absolute inset-x-0 border-t border-orv-hairline"
                style={{ top: h * HOUR_PX }}
              >
                <span className="absolute -left-12 -top-2 w-10 text-right text-[11px] text-orv-faint">
                  {h === 0 ? '' : timeLabel(atLocal(day, h * 60)).replace(':00', '')}
                </span>
              </div>
            ))}

            {free.map((f) => (
              <div
                key={`free-${f.start}`}
                data-testid="free-time"
                className="absolute inset-x-1 rounded-orv-md border border-dashed border-orv-edge"
                style={{
                  top: (f.start / 60) * HOUR_PX,
                  height: ((f.end - f.start) / 60) * HOUR_PX,
                  background: 'color-mix(in srgb, var(--orv-accent) 5%, transparent)',
                }}
              >
                <span className="absolute right-2 top-1 text-[11px] text-orv-faint">
                  Free · {durationLabel(f.end - f.start)}
                </span>
              </div>
            ))}

            {/* the drop surface: drag a task here to give it a time; click to add an event */}
            <div
              role="presentation"
              data-testid="river"
              className="absolute inset-0"
              onDragOver={(e) => {
                e.preventDefault();
                setHover(minutesAt(e));
              }}
              onDragLeave={() => setHover(null)}
              onDrop={(e) => void drop(e)}
              onDoubleClick={(e) => onEdit(newDraft(day, minutesAt(e), settings))}
            />
            {hover !== null ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-1 rounded-orv-md border-2 border-orv-accent"
                style={{ top: (hover / 60) * HOUR_PX, height: HOUR_PX / 2 }}
              >
                <span className="ml-2 text-[11px] font-semibold text-orv-accent">
                  {timeLabel(atLocal(day, hover))}
                </span>
              </div>
            ) : null}

            {blocks.map((b) => {
              const task = b.kind === 'task' ? tasks.find((t) => t.id === b.id) : undefined;
              const ev =
                b.kind === 'event'
                  ? instances.find((i) => `e-${i.eventId}-${i.occurrence ?? ''}` === b.key)
                  : undefined;
              const width = 100 / (b.cols ?? 1);
              const colour = b.kind === 'event' ? labelColour(b.colour) : 'var(--orv-accent)';
              return (
                <motion.button
                  key={b.key}
                  layout
                  transition={spring.smooth}
                  draggable={b.kind === 'task' || !ev?.seriesId}
                  onDragStart={(e) =>
                    (e as unknown as DragEvent).dataTransfer.setData(
                      b.kind === 'task' ? DRAG_TASK : DRAG_EVENT,
                      b.id,
                    )
                  }
                  onClick={() => (task ? onOpenTask(task) : ev ? onEdit(draftFrom(events, ev)) : undefined)}
                  aria-label={`${b.title}, ${timeLabel(atLocal(day, b.start))} to ${timeLabel(atLocal(day, b.end))}${b.kind === 'task' ? ', task' : ''}`}
                  className={cn(
                    'absolute overflow-hidden rounded-orv-md border px-2 py-1 text-left text-[12px] leading-tight',
                    b.kind === 'task' ? 'border-dashed' : 'border-transparent',
                  )}
                  style={{
                    top: (b.start / 60) * HOUR_PX + 1,
                    height: Math.max(20, ((b.end - b.start) / 60) * HOUR_PX - 2),
                    left: `calc(${(b.col ?? 0) * width}% + 4px)`,
                    width: `calc(${width}% - 8px)`,
                    color: 'var(--orv-text)',
                    borderColor: b.kind === 'task' ? colour : undefined,
                    background: `color-mix(in srgb, ${colour} ${b.kind === 'task' ? 10 : 20}%, var(--orv-glass-strong))`,
                    boxShadow: b.kind === 'event' ? `inset 3px 0 0 ${colour}` : undefined,
                  }}
                >
                  <span className="block truncate font-semibold">{b.title}</span>
                  <span className="text-orv-muted">
                    {timeLabel(atLocal(day, b.start))}
                    {b.end - b.start >= 45 ? ` – ${timeLabel(atLocal(day, b.end))}` : ''}
                  </span>
                </motion.button>
              );
            })}

            {isToday ? (
              <div
                aria-label={`Now, ${timeLabel(now)}`}
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                style={{ top: (minutesOf(now) / 60) * HOUR_PX }}
              >
                <span className="-ml-1.5 h-3 w-3 rounded-full [background:var(--orv-accent-grad)]" />
                <span className="h-0.5 flex-1 [background:var(--orv-accent-grad)]" />
              </div>
            ) : null}
          </div>
        </div>
        {!settings ? (
          <p className="border-t border-orv-edge px-4 py-2 text-small text-orv-muted">
            Set your working hours in Today settings to see your free time here.
          </p>
        ) : null}
      </Glass>

      <Glass className="flex flex-col gap-2 p-3" aria-label="To place">
        <Label>To place {unplaced.length ? `· ${unplaced.length}` : ''}</Label>
        {unplaced.length ? (
          <p className="text-[12px] text-orv-faint">
            Drag onto the river, or use Place for the first free slot.
          </p>
        ) : (
          <p className="text-small text-orv-muted">Everything for this day has a time.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {unplaced.map((t) => {
            const len = t.durationMin ?? 30;
            const slot = free.find((f) => f.end - f.start >= len);
            return (
              <li
                key={t.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TASK, t.id)}
                className="glass-pane flex cursor-grab items-center gap-2 p-2"
              >
                <GripVertical size={14} aria-hidden className="shrink-0 text-orv-faint" />
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(t)}>
                  <span className="block truncate text-[13px] font-medium">{t.title}</span>
                  <span className="text-[11px] text-orv-faint">
                    {durationLabel(len)}
                    {t.dueDate && t.dueDate < day ? ' · overdue' : ''}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!slot}
                  aria-label={`Place ${t.title}`}
                  onClick={() =>
                    slot &&
                    void updateTask(t.id, {
                      scheduledStart: atLocal(day, slot.start).toISOString(),
                      durationMin: len,
                    })
                  }
                >
                  Place
                </Button>
              </li>
            );
          })}
        </ul>
      </Glass>
    </div>
  );
}

// ================================================================== week and month

function WeekView({
  day,
  onOpenTask,
  onEdit,
  onPickDay,
}: {
  day: string;
  onOpenTask(t: Task): void;
  onEdit(d: EventDraft): void;
  onPickDay(d: string): void;
}) {
  const { tasks, events, calendars } = useToday();
  const days = weekOf(day);
  const instances = useInstances(days[0]!, shiftDay(days[6]!, 1));
  const today = localDay(new Date());
  const colourOf = (id: string | null) => calendars.find((c) => c.id === id)?.colour ?? 'sky';
  return (
    <div className="grid gap-2 sm:grid-cols-7" role="list" aria-label="Week">
      {days.map((d) => {
        const items = [
          ...instances
            .filter((i) => allDayOn(i, d) || onDay(i, d))
            .map((i) => ({
              key: `e-${i.eventId}-${i.occurrence ?? ''}`,
              at: i.allDay ? -1 : onDay(i, d)!.start,
              title: i.title,
              colour: labelColour(colourOf(i.calendarId)),
              open: () => onEdit(draftFrom(events, i)),
              time: i.allDay ? 'All day' : timeLabel(atLocal(d, onDay(i, d)!.start)),
            })),
          ...tasks
            .filter((t) => !t.completedAt && taskDay(t) === d)
            .map((t) => {
              const at = t.scheduledStart ?? t.dueAt;
              return {
                key: `t-${t.id}`,
                at: at ? minutesOf(new Date(at)) : 24 * 60,
                title: t.title,
                colour: 'var(--orv-accent)',
                open: () => onOpenTask(t),
                time: at ? timeLabel(new Date(at)) : 'Task',
              };
            }),
        ].sort((a, b) => a.at - b.at);
        return (
          <Glass key={d} className="flex min-h-40 flex-col gap-1.5 p-2" role="listitem">
            <button
              onClick={() => onPickDay(d)}
              className={cn(
                'flex items-baseline gap-1.5 rounded-orv-sm px-1 text-left',
                d === today ? 'text-orv-accent' : '',
              )}
              aria-label={`Open ${dayTitle(d, { weekday: 'long', day: 'numeric', month: 'long' })}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {dayTitle(d, { weekday: 'short' })}
              </span>
              <span className="text-[17px] font-semibold">{Number(d.slice(8))}</span>
            </button>
            {items.map((it) => (
              <button
                key={it.key}
                onClick={it.open}
                className="rounded-orv-sm px-1.5 py-1 text-left text-[12px] leading-tight hover:bg-orv-track"
                style={{ boxShadow: `inset 2px 0 0 ${it.colour}` }}
              >
                <span className="block text-[11px] text-orv-faint">{it.time}</span>
                <span className="block truncate font-medium">{it.title}</span>
              </button>
            ))}
          </Glass>
        );
      })}
    </div>
  );
}

function MonthView({ day, onPickDay }: { day: string; onPickDay(d: string): void }) {
  const { tasks, calendars } = useToday();
  const grid = monthGrid(day);
  const instances = useInstances(grid[0]!, shiftDay(grid[41]!, 1));
  const month = day.slice(0, 7);
  const today = localDay(new Date());
  const colourOf = (id: string | null) => calendars.find((c) => c.id === id)?.colour ?? 'sky';
  return (
    <Glass className="p-2">
      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase text-orv-faint">
        {grid.slice(0, 7).map((d) => (
          <span key={d}>{dayTitle(d, { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Month">
        {grid.map((d) => {
          const items = [
            ...instances
              .filter((i) => allDayOn(i, d) || onDay(i, d))
              .map((i) => ({
                key: `${i.eventId}${i.occurrence}`,
                title: i.title,
                colour: labelColour(colourOf(i.calendarId)),
              })),
            ...tasks
              .filter((t) => !t.completedAt && taskDay(t) === d)
              .map((t) => ({ key: t.id, title: t.title, colour: 'var(--orv-accent)' })),
          ];
          return (
            <button
              key={d}
              role="gridcell"
              onClick={() => onPickDay(d)}
              aria-label={`${dayTitle(d, { weekday: 'long', day: 'numeric', month: 'long' })}${items.length ? `, ${items.length} items` : ''}`}
              className={cn(
                'flex min-h-20 flex-col gap-0.5 rounded-orv-sm p-1 text-left hover:bg-orv-track',
                d.slice(0, 7) !== month && 'opacity-45',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold',
                  d === today && 'text-white [background:var(--orv-accent-grad)]',
                )}
              >
                {Number(d.slice(8))}
              </span>
              {items.slice(0, 3).map((it) => (
                <span
                  key={it.key}
                  className="truncate rounded px-1 text-[11px] leading-[16px]"
                  style={{ boxShadow: `inset 2px 0 0 ${it.colour}` }}
                >
                  {it.title}
                </span>
              ))}
              {items.length > 3 ? (
                <span className="px-1 text-[11px] text-orv-faint">+{items.length - 3} more</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Glass>
  );
}

// ================================================================== plan my day

function PlanButton({ day, onPlan }: { day: string; onPlan(p: Plan): void }) {
  const { settings, events, calendars, tasks } = useToday();
  const toast = useToast();
  return (
    <Button
      size="sm"
      onClick={() => {
        if (!settings) {
          toast({
            title: 'Set your working hours first',
            body: 'Today settings → Working hours.',
            tone: 'danger',
          });
          return;
        }
        onPlan(
          planFromRecords({
            date: day,
            now: new Date(),
            settings,
            events,
            hiddenCalendars: new Set(calendars.filter((c) => !c.visible).map((c) => c.id)),
            tasks,
          }),
        );
      }}
    >
      <Wand2 size={14} /> Plan my day
    </Button>
  );
}

function PlanSheet({ plan, onClose }: { plan: Plan | null; onClose(): void }) {
  const { updateTask } = useToday();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    if (!plan) return;
    setBusy(true);
    for (const p of plan.placed) {
      await updateTask(p.taskId, {
        scheduledStart: p.start,
        durationMin: Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000),
      });
    }
    setBusy(false);
    toast({
      title: `Planned ${plan.placed.length} task${plan.placed.length === 1 ? '' : 's'}`,
      tone: 'success',
    });
    onClose();
  };
  return (
    <Sheet open={!!plan} onClose={onClose} title="Your plan">
      {plan ? (
        <div className="flex flex-col gap-3">
          {plan.hours.length ? (
            <p className="text-small text-orv-muted">
              Inside your working hours ({plan.hours.map((h) => `${h.start}–${h.end}`).join(', ')}), around
              your events, with your gaps. Nothing changes until you accept.
            </p>
          ) : null}
          {plan.placed.length ? (
            <ol className="flex flex-col gap-2" aria-label="Placed">
              {plan.placed.map((p) => (
                <li key={p.taskId} className="glass-pane flex gap-3 p-3">
                  <span className="w-16 shrink-0 text-[13px] font-semibold text-orv-accent">
                    {timeLabel(new Date(p.start))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{p.title}</span>
                    <span className="block text-[12px] text-orv-muted">{p.reason}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-small text-orv-muted">Nothing to place for this day.</p>
          )}
          {plan.unplaced.length ? (
            <div aria-label="Didn’t fit">
              <Label>Didn’t fit</Label>
              <ul className="mt-1 flex flex-col gap-1">
                {plan.unplaced.map((u) => (
                  <li key={u.taskId} className="text-[13px]">
                    <span className="font-medium">{u.title}</span>
                    <span className="text-orv-muted"> — {u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button onClick={() => void accept()} disabled={!plan.placed.length} loading={busy}>
              <Sparkles size={14} /> Accept plan
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

// ================================================================== creating and editing events

interface EventDraft {
  /** the stored row being edited (null = new) */
  id: string | null;
  /** when editing one occurrence of a series */
  seriesId: string | null;
  occurrence: string | null;
  isOverride: boolean;
  title: string;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  rrule: string;
  location: string;
  notes: string;
  calendarId: string | null;
  timeZone: string;
}

function newDraft(day: string, minutes: number, settings: TodaySettingsFields | null): EventDraft {
  return {
    id: null,
    seriesId: null,
    occurrence: null,
    isOverride: false,
    title: '',
    allDay: false,
    date: day,
    endDate: shiftDay(day, 1),
    startTime: hhmm(minutes),
    endTime: hhmm(Math.min(24 * 60 - 1, minutes + 60)),
    rrule: '',
    location: '',
    notes: '',
    calendarId: null,
    timeZone: settings?.timeZone ?? browserZone(),
  };
}

function draftFrom(events: CalEvent[], i: Instance): EventDraft {
  const row = events.find((e) => e.id === i.eventId)!;
  const series = i.seriesId ? (events.find((e) => e.id === i.seriesId) ?? row) : row;
  const s = i.start ? new Date(i.start) : null;
  const e = i.end ? new Date(i.end) : null;
  return {
    id: row.id,
    seriesId: i.seriesId,
    occurrence: i.occurrence,
    isOverride: !!row.recurringEventId,
    title: row.title,
    allDay: row.allDay,
    date: i.allDay ? i.startDate! : localDay(s!),
    endDate: i.allDay ? i.endDate! : shiftDay(localDay(s!), 1),
    startTime: s ? hhmm(minutesOf(s)) : '09:00',
    endTime: e ? hhmm(minutesOf(e)) : '10:00',
    rrule: series.rrule ?? '',
    location: row.location,
    notes: row.notes,
    calendarId: row.calendarId,
    timeZone: row.timeZone,
  };
}

function fieldsOf(d: EventDraft): Partial<CalEvent> {
  const start = d.allDay ? null : atLocal(d.date, toMinutes(d.startTime));
  let end = d.allDay ? null : atLocal(d.date, toMinutes(d.endTime));
  if (start && end && end <= start) end = new Date(end.getTime() + 86_400_000); // ends after midnight
  return {
    title: d.title.trim(),
    allDay: d.allDay,
    start: start?.toISOString() ?? null,
    end: end?.toISOString() ?? null,
    startDate: d.allDay ? d.date : null,
    endDate: d.allDay ? (d.endDate > d.date ? d.endDate : shiftDay(d.date, 1)) : null,
    location: d.location,
    notes: d.notes,
    calendarId: d.calendarId,
    timeZone: d.timeZone,
  };
}
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function EventSheet({ draft, onClose }: { draft: EventDraft | null; onClose(): void }) {
  const { events, calendars, addEvent, updateEvent, removeEvent } = useToday();
  const toast = useToast();
  const [d, setD] = useState<EventDraft | null>(draft);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  useEffect(() => {
    setD(draft);
    setScope('one');
  }, [draft]);
  const writable = calendars.filter((c) => c.writable);
  const inSeries = !!d?.seriesId;
  const problem = d ? (d.title.trim() ? eventProblem(fieldsOf(d)) : 'Give it a name') : null;

  const save = async () => {
    if (!d || problem) return;
    const f = fieldsOf(d);
    if (!d.id) {
      await addEvent({ ...(f as CalEvent), rrule: d.rrule || null });
    } else if (!inSeries) {
      await updateEvent(d.id, { ...f, rrule: d.rrule || null });
    } else if (scope === 'one') {
      // one occurrence: the change becomes (or updates) its own event pointing at the series
      if (d.isOverride) await updateEvent(d.id, f);
      else
        await addEvent({
          ...(f as CalEvent),
          rrule: null,
          recurringEventId: d.seriesId,
          originalStart: d.occurrence,
        });
    } else {
      // the whole series: move it by the same amount this occurrence moved
      const series = events.find((e) => e.id === d.seriesId)!;
      const patch: Partial<CalEvent> = {
        title: f.title,
        location: f.location,
        notes: f.notes,
        calendarId: f.calendarId,
        rrule: d.rrule || null,
      };
      if (!series.allDay && d.occurrence && series.start && series.end && f.start && f.end) {
        const delta = Date.parse(f.start) - Date.parse(d.occurrence);
        patch.start = new Date(Date.parse(series.start) + delta).toISOString();
        patch.end = new Date(
          Date.parse(series.start) + delta + (Date.parse(f.end) - Date.parse(f.start)),
        ).toISOString();
      }
      await updateEvent(series.id, patch);
    }
    toast({ title: d.id ? 'Event saved' : 'Event added', body: f.title, tone: 'success' });
    onClose();
  };

  const remove = async () => {
    if (!d?.id) return;
    if (inSeries && scope === 'one') {
      const series = events.find((e) => e.id === d.seriesId);
      if (series && d.occurrence)
        await updateEvent(series.id, { exdates: [...series.exdates, d.occurrence] });
      if (d.isOverride) await removeEvent(d.id);
    } else {
      const seriesId = d.seriesId ?? d.id;
      for (const e of events.filter((x) => x.recurringEventId === seriesId)) await removeEvent(e.id);
      await removeEvent(seriesId);
    }
    toast({ title: 'Event deleted', body: d.title });
    onClose();
  };

  const presets = d ? repeatPresets(d.date) : [];
  const custom = d && d.rrule && !presets.some((p) => p.value === d.rrule);

  return (
    <Sheet
      open={!!draft}
      onClose={onClose}
      title={draft?.id ? 'Event' : 'New event'}
      footer={
        d ? (
          <>
            {d.id ? (
              <Button type="button" variant="ghost" onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
            <Button type="submit" form="event-form" disabled={!!problem}>
              Save
            </Button>
          </>
        ) : undefined
      }
    >
      {d ? (
        <form
          id="event-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={d.title}
                maxLength={500}
                onChange={(e) => setD({ ...d, title: e.target.value })}
              />
            )}
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[14px]">All day</span>
            <Switch checked={d.allDay} onChange={(v) => setD({ ...d, allDay: v })} label="All day" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={d.date}
                  onChange={(e) => setD({ ...d, date: e.target.value })}
                />
              )}
            </Field>
            {d.allDay ? (
              <Field label="Last day">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={shiftDay(d.endDate, -1)}
                    min={d.date}
                    onChange={(e) => setD({ ...d, endDate: shiftDay(e.target.value, 1) })}
                  />
                )}
              </Field>
            ) : (
              <>
                <Field label="Starts">
                  {(id) => (
                    <Input
                      id={id}
                      type="time"
                      value={d.startTime}
                      onChange={(e) => {
                        const len = toMinutes(d.endTime) - toMinutes(d.startTime);
                        const s = toMinutes(e.target.value || '00:00');
                        setD({
                          ...d,
                          startTime: e.target.value,
                          endTime: hhmm(Math.min(24 * 60 - 1, s + Math.max(15, len))),
                        });
                      }}
                    />
                  )}
                </Field>
                <Field label="Ends">
                  {(id) => (
                    <Input
                      id={id}
                      type="time"
                      value={d.endTime}
                      onChange={(e) => setD({ ...d, endTime: e.target.value })}
                    />
                  )}
                </Field>
              </>
            )}
          </div>
          <Field label="Repeat">
            {(id) => (
              <select
                id={id}
                value={d.rrule}
                disabled={inSeries && scope === 'one'}
                onChange={(e) => setD({ ...d, rrule: e.target.value })}
                className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
              >
                {presets.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                {custom ? <option value={d.rrule}>{describeRepeat(d.rrule)}</option> : null}
              </select>
            )}
          </Field>
          {writable.length ? (
            <Field label="Calendar">
              {(id) => (
                <select
                  id={id}
                  value={d.calendarId ?? ''}
                  onChange={(e) => setD({ ...d, calendarId: e.target.value || null })}
                  className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
                >
                  <option value="">ORVYN</option>
                  {writable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field label="Where">
            {(id) => (
              <Input
                id={id}
                value={d.location}
                maxLength={500}
                onChange={(e) => setD({ ...d, location: e.target.value })}
              />
            )}
          </Field>
          <Field label="Notes">
            {(id) => (
              <textarea
                id={id}
                value={d.notes}
                rows={2}
                onChange={(e) => setD({ ...d, notes: e.target.value })}
                className="w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 py-2 text-[14px]"
              />
            )}
          </Field>
          {inSeries ? (
            <div className="flex items-center gap-2">
              <Badge>Repeats</Badge>
              <Segmented
                label="Change"
                value={scope}
                onChange={(v) => setScope(v as 'one' | 'all')}
                options={[
                  { value: 'one', label: 'Only this one' },
                  { value: 'all', label: 'All of them' },
                ]}
              />
            </div>
          ) : null}
          {problem && d.title.trim() ? <p className="text-small text-orv-danger">{problem}</p> : null}
        </form>
      ) : null}
    </Sheet>
  );
}
