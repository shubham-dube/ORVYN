'use client';

import type { CalEvent } from '@orvyn/contracts';
import { expandEvents, type Instance } from '@orvyn/today-plan';
import { CalendarClock, ChevronDown, ChevronUp, EllipsisVertical, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Glass, Label } from '@/components/ui/bits';
import { cn } from '@/lib/cn';
import { localDay, useToday } from '@/lib/today';
import { hm, joinLink } from '@/lib/work';
import { draftFrom, type EventDraft, EventSheet } from './today-calendar';

/**
 * Meetings in the list and the board (spec 0012 M). The state comes from the clock, never stored: upcoming →
 * starting soon (10 min) → now (time left, a progress line) → ended, folded under "Earlier today". A meeting ends
 * by itself; it is not a task.
 */
type State = 'upcoming' | 'soon' | 'now' | 'ended';
interface Meeting {
  i: Instance;
  event: CalEvent | undefined;
  colour: string;
  start: number;
  end: number;
}

const stateAt = (m: Meeting, now: number): State =>
  now >= m.end ? 'ended' : now >= m.start ? 'now' : m.start - now < 10 * 60_000 ? 'soon' : 'upcoming';
const rel = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1
    ? 'less than a minute'
    : m < 60
      ? `${m} min`
      : m % 60
        ? `${Math.floor(m / 60)} h ${m % 60} min`
        : `${m / 60} h`;
};
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

/** Today's timed meetings from visible calendars, in order, and the all-day ones. */
export function useTodayMeetings() {
  const { events, calendars } = useToday();
  const day = localDay(new Date());
  return useMemo(() => {
    const hidden = new Set(calendars.filter((c) => !c.visible).map((c) => c.id));
    const d0 = new Date(`${day}T00:00`);
    const d1 = new Date(d0.getTime() + 86_400_000);
    const all = expandEvents(events, d0, d1, hidden);
    const colourOf = new Map(calendars.map((c) => [c.id, c.colour]));
    const byId = new Map(events.map((e) => [e.id, e]));
    const timed: Meeting[] = all
      .filter((i) => !i.allDay && i.start && i.end)
      .map((i) => ({
        i,
        event: byId.get(i.eventId) ?? (i.seriesId ? byId.get(i.seriesId) : undefined),
        colour: `var(--orv-label-${colourOf.get(i.calendarId ?? '') ?? 'sky'})`,
        start: Date.parse(i.start!),
        end: Date.parse(i.end!),
      }))
      .sort((a, b) => a.start - b.start);
    return { timed, allDay: all.filter((i) => i.allDay) };
  }, [events, calendars, day]);
}

export function ScheduleGroup({ onFollowUp }: { onFollowUp(title: string): void }) {
  const { timed, allDay } = useTodayMeetings();
  const { events } = useToday();
  const now = useNow();
  const [showEnded, setShowEnded] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  if (!timed.length && !allDay.length) return null;
  const ended = timed.filter((m) => stateAt(m, now) === 'ended');
  const ahead = timed.filter((m) => stateAt(m, now) !== 'ended');
  return (
    <Glass as="section" className="p-4" aria-label="Schedule">
      <div className="mb-2 flex items-center gap-2 px-1">
        <CalendarClock size={14} className="text-orv-accent" aria-hidden />
        <Label>Schedule</Label>
        {ahead.length ? <span className="text-[12px] text-orv-muted">{ahead.length}</span> : null}
        {!ahead.length && ended.length ? (
          <span className="text-[12px] text-orv-muted">That’s every meeting for today.</span>
        ) : null}
      </div>
      {allDay.length ? (
        <div className="mb-1 flex flex-wrap gap-1.5 px-1">
          {allDay.map((a) => (
            <span
              key={`${a.eventId}-${a.occurrence}`}
              className="rounded-full bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)] px-2.5 py-0.5 text-[12px] font-semibold"
            >
              All day · {a.title}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {ahead.map((m) => (
          <MeetingRow
            key={`${m.i.eventId}-${m.i.occurrence}`}
            m={m}
            now={now}
            onOpen={() => setDraft(draftFrom(events, m.i))}
            onFollowUp={onFollowUp}
          />
        ))}
      </ul>
      {ended.length ? (
        <button
          type="button"
          aria-expanded={showEnded}
          onClick={() => setShowEnded((v) => !v)}
          className="mt-1 flex items-center gap-1.5 px-1 py-1 text-[12.5px] font-semibold text-orv-muted hover:text-orv-text"
        >
          {showEnded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Earlier today ({ended.length})
        </button>
      ) : null}
      {showEnded ? (
        <ul className="flex flex-col gap-0.5">
          {ended.map((m) => (
            <MeetingRow
              key={`${m.i.eventId}-${m.i.occurrence}`}
              m={m}
              now={now}
              onOpen={() => setDraft(draftFrom(events, m.i))}
              onFollowUp={onFollowUp}
            />
          ))}
        </ul>
      ) : null}
      <EventSheet draft={draft} onClose={() => setDraft(null)} />
    </Glass>
  );
}

function MeetingRow({
  m,
  now,
  onOpen,
  onFollowUp,
}: {
  m: Meeting;
  now: number;
  onOpen(): void;
  onFollowUp(t: string): void;
}) {
  const st = stateAt(m, now);
  const join = m.event ? joinLink(m.event.location, m.event.notes) : joinLink(m.i.location ?? '', '');
  const [menu, setMenu] = useState(false);
  const status =
    st === 'now'
      ? `Now · ends in ${rel(m.end - now)}`
      : st === 'soon'
        ? `In ${rel(m.start - now)}`
        : st === 'ended'
          ? 'Ended'
          : null;
  return (
    <li
      className={cn(
        'relative flex items-center gap-3 rounded-orv-md border px-1.5 py-2 transition-colors',
        st === 'soon' || st === 'now' ? '' : 'border-transparent',
        st === 'ended' && 'opacity-50',
      )}
      style={
        st === 'soon' || st === 'now'
          ? {
              borderColor: `color-mix(in srgb, ${m.colour} 60%, transparent)`,
              background: st === 'now' ? `color-mix(in srgb, ${m.colour} 10%, transparent)` : undefined,
            }
          : undefined
      }
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex w-16 shrink-0 flex-col">
          <span className="tabular text-[13px] font-bold">{time(m.start)}</span>
          <span className="text-[11.5px] text-orv-muted">{hm(Math.round((m.end - m.start) / 60_000))}</span>
        </span>
        <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: m.colour }} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-[15px] font-medium', st === 'ended' && 'line-through')}>
            {m.i.title}
          </span>
          {status ? (
            <span
              className="flex items-center gap-1.5 text-[12px] font-semibold"
              style={st === 'ended' ? undefined : { color: m.colour }}
            >
              {st === 'now' ? (
                <span className="relative flex size-2">
                  <span
                    className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
                    style={{ background: m.colour }}
                  />
                  <span
                    className="relative inline-flex size-2 rounded-full"
                    style={{ background: m.colour }}
                  />
                </span>
              ) : null}
              {status}
            </span>
          ) : m.event?.location && !join ? (
            <span className="truncate text-[12px] text-orv-muted">{m.event.location}</span>
          ) : null}
          {st === 'now' ? (
            <span
              className="mt-1.5 h-[3px] overflow-hidden rounded-full"
              style={{ background: `color-mix(in srgb, ${m.colour} 15%, transparent)` }}
            >
              <span
                className="block h-full rounded-full transition-[width] duration-1000"
                style={{
                  width: `${Math.min(100, ((now - m.start) / (m.end - m.start)) * 100)}%`,
                  background: m.colour,
                }}
              />
            </span>
          ) : null}
        </span>
      </button>
      {join && st !== 'ended' ? (
        <a
          href={join}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold',
            st === 'upcoming'
              ? 'bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] text-orv-accent'
              : 'text-white [background:var(--orv-accent-grad)]',
          )}
        >
          <Video size={14} aria-hidden /> Join
        </a>
      ) : null}
      <div className="relative">
        <button
          type="button"
          aria-label="More"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          className="grid size-8 place-items-center rounded-full text-orv-faint hover:bg-orv-track"
        >
          <EllipsisVertical size={15} />
        </button>
        {menu ? (
          <div
            role="menu"
            className="glass-float absolute right-0 top-9 z-20 flex w-52 flex-col p-1"
            onMouseLeave={() => setMenu(false)}
          >
            <button
              role="menuitem"
              className="rounded-orv-sm px-3 py-2 text-left text-[14px] hover:bg-orv-track"
              onClick={() => {
                setMenu(false);
                onFollowUp(`Follow up: ${m.i.title}`);
              }}
            >
              Make a follow-up task
            </button>
            <button
              role="menuitem"
              className="rounded-orv-sm px-3 py-2 text-left text-[14px] hover:bg-orv-track"
              onClick={() => {
                setMenu(false);
                onOpen();
              }}
            >
              Open the event
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** On the board: what's on now and the next two. */
export function ScheduleStrip() {
  const { timed } = useTodayMeetings();
  const now = useNow();
  const ahead = timed.filter((m) => stateAt(m, now) !== 'ended').slice(0, 3);
  if (!ahead.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Today’s schedule">
      {ahead.map((m) => (
        <Glass
          key={`${m.i.eventId}-${m.i.occurrence}`}
          className="flex shrink-0 items-center gap-2 px-3 py-2"
        >
          <span aria-hidden className="h-7 w-[3px] rounded-full" style={{ background: m.colour }} />
          <span className="flex flex-col">
            <span className="max-w-48 truncate text-[13px] font-semibold">{m.i.title}</span>
            <span className="text-[11px] text-orv-muted">
              {stateAt(m, now) === 'now'
                ? `Now · ${rel(m.end - now)} left`
                : `${time(m.start)} · ${hm(Math.round((m.end - m.start) / 60_000))}`}
            </span>
          </span>
        </Glass>
      ))}
    </div>
  );
}
