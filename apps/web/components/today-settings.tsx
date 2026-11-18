'use client';

import { WaysPicker } from '@/components/ways-picker';
import {
  STARTING_SETTINGS,
  type TimeRange,
  type TodaySettingsFields,
  TodaySettingsFields as Schema,
  type WeekPattern,
  WEEKDAYS,
  type WorkingPattern,
} from '@orvyn/contracts';
import { CalendarClock, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Glass, Label, Segmented, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { localDay, useToday } from '@/lib/today';

const DAY_NAMES: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
export const LEAD_CHOICES = [5, 10, 15, 30, 60, 120, 1440, 2880];

export function leadLabel(min: number): string {
  if (min === 0) return 'at the time';
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'} before`;
  if (min % 60 === 0) return `${min / 60} h before`;
  return `${min} min before`;
}

const fmtDate = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings → Today: everything here is the person's own (D15–D17). Nothing applies until they save. */
export function TodaySettings() {
  const { settings, saveSettings, ready } = useToday();
  const toast = useToast();
  const [draft, setDraft] = useState<TodaySettingsFields>(settings ?? STARTING_SETTINGS);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty)
      setDraft(
        settings ?? { ...STARTING_SETTINGS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      );
  }, [settings, dirty]);
  if (!ready) return null;

  const edit = (patch: Partial<TodaySettingsFields>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const parsed = Schema.safeParse(draft);
  const error = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check your settings');
  const today = localDay(new Date());
  const patterns = [...draft.patterns].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const currentFrom = [...patterns].reverse().find((p) => p.validFrom <= today)?.validFrom;

  const save = async () => {
    if (!parsed.success) return;
    await saveSettings(settings ? diff(settings, parsed.data) : parsed.data); // first save sends everything
    setDirty(false);
    toast({ title: 'Saved', body: 'Used on all your devices.', tone: 'success' });
  };

  return (
    <Glass as="section" className="flex flex-col gap-5 p-5" data-module="today">
      <header id="today">
        <h2 className="text-heading font-semibold">Today</h2>
        <p className="text-small text-orv-muted">
          Your working hours and reminders. Change them whenever your days change — a new pattern can start on
          any date.
        </p>
        {!settings ? (
          <p className="mt-2 rounded-orv-md border border-orv-edge px-3 py-2 text-small">
            <strong>Not set up yet.</strong> These are suggestions only; nothing is used until you save.
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-3">
        <Label>Working hours</Label>
        {patterns.map((p) => (
          <PatternEditor
            key={p.validFrom}
            pattern={p}
            badge={
              p.validFrom === currentFrom
                ? 'Now'
                : p.validFrom > today
                  ? `From ${fmtDate(p.validFrom)}`
                  : 'Earlier'
            }
            canRemove={patterns.length > 1}
            onChange={(next) =>
              edit({ patterns: draft.patterns.map((x) => (x.validFrom === p.validFrom ? next : x)) })
            }
            onRemove={() => edit({ patterns: draft.patterns.filter((x) => x.validFrom !== p.validFrom) })}
          />
        ))}
        <NewPattern
          existing={draft.patterns.map((p) => p.validFrom)}
          from={patterns.find((p) => p.validFrom === currentFrom) ?? patterns[0]!}
          onAdd={(p) => edit({ patterns: [...draft.patterns, p] })}
        />
      </div>

      <DayOverrides value={draft.dayOverrides} onChange={(dayOverrides) => edit({ dayOverrides })} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Gap between planned items (min)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={120}
              value={draft.bufferMin}
              onChange={(e) => edit({ bufferMin: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Don’t plan after">
          {(id) => (
            <Input
              id={id}
              type="time"
              value={draft.noPlanAfter}
              onChange={(e) => edit({ noPlanAfter: e.target.value })}
            />
          )}
        </Field>
        <Field label="Time zone">
          {(id) => (
            <Input id={id} value={draft.timeZone} onChange={(e) => edit({ timeZone: e.target.value })} />
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <Label>Reminders</Label>
        <LeadTimes
          label="For things with a time"
          value={draft.reminders.timed}
          onChange={(timed) => edit({ reminders: { ...draft.reminders, timed } })}
        />
        <WaysPicker
          label="Remind me by"
          value={draft.reminders.via}
          onChange={(via) => edit({ reminders: { ...draft.reminders, via } })}
        />
        <div className="flex flex-wrap items-end gap-3">
          <Segmented<'digest' | 'ping' | 'none'>
            label="For things with only a date"
            value={draft.reminders.dateOnly.mode}
            onChange={(mode) =>
              edit({
                reminders: {
                  ...draft.reminders,
                  dateOnly:
                    mode === 'none'
                      ? { mode }
                      : {
                          mode,
                          at: 'at' in draft.reminders.dateOnly ? draft.reminders.dateOnly.at : '09:00',
                        },
                },
              })
            }
            options={[
              { value: 'digest', label: 'One summary' },
              { value: 'ping', label: 'Each task' },
              { value: 'none', label: 'Nothing' },
            ]}
          />
          {draft.reminders.dateOnly.mode !== 'none' ? (
            <Field label="At">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  className="w-32"
                  value={draft.reminders.dateOnly.mode !== 'none' ? draft.reminders.dateOnly.at : ''}
                  onChange={(e) =>
                    edit({
                      reminders: {
                        ...draft.reminders,
                        dateOnly: {
                          mode: draft.reminders.dateOnly.mode as 'digest' | 'ping',
                          at: e.target.value,
                        },
                      },
                    })
                  }
                />
              )}
            </Field>
          ) : null}
        </div>
        {draft.reminders.dateOnly.mode !== 'none' ? (
          <WaysPicker
            label="Send the summary by"
            value={draft.reminders.dateOnlyVia}
            onChange={(dateOnlyVia) => edit({ reminders: { ...draft.reminders, dateOnlyVia } })}
            tryable={false}
          />
        ) : null}
        <Switch
          label="Include overdue tasks in the summary"
          checked={draft.reminders.overdueInDigest}
          onChange={(overdueInDigest) => edit({ reminders: { ...draft.reminders, overdueInDigest } })}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {error ? (
          <p role="alert" className="mr-auto text-small text-orv-danger">
            {error}
          </p>
        ) : null}
        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDirty(false);
              setDraft(settings ?? STARTING_SETTINGS);
            }}
          >
            Undo changes
          </Button>
        ) : null}
        <Button variant="primary" disabled={!!error || (!dirty && !!settings)} onClick={() => void save()}>
          {settings ? 'Save' : 'Use these settings'}
        </Button>
      </div>
    </Glass>
  );
}

function diff(a: TodaySettingsFields, b: TodaySettingsFields): Partial<TodaySettingsFields> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof TodaySettingsFields)[])
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  return out as Partial<TodaySettingsFields>;
}

function Ranges({
  value,
  onChange,
  label,
}: {
  value: TimeRange[];
  onChange(v: TimeRange[]): void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {value.length === 0 ? <span className="text-small text-orv-muted">Off</span> : null}
      {value.map((r, i) => (
        <span key={i} className="flex items-center gap-1 rounded-orv-sm border border-orv-edge px-1.5 py-0.5">
          <input
            aria-label={`${label} start ${i + 1}`}
            type="time"
            value={r.start}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
            className="bg-transparent text-[13px] outline-none"
          />
          <span aria-hidden>–</span>
          <input
            aria-label={`${label} end ${i + 1}`}
            type="time"
            value={r.end}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
            className="bg-transparent text-[13px] outline-none"
          />
          <button
            aria-label={`Remove ${label} range ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="rounded-full p-0.5 text-orv-muted hover:bg-orv-track"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        aria-label={`Add ${label} range`}
        onClick={() => {
          const last = value.at(-1);
          const start = last ? last.end : '09:00';
          const h = Math.min(23, Number(start.slice(0, 2)) + 1);
          onChange([
            ...value,
            { start, end: `${String(h).padStart(2, '0')}:${h === 23 ? '59' : start.slice(3)}` },
          ]);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full text-orv-accent hover:bg-orv-track"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function PatternEditor({
  pattern,
  badge,
  canRemove,
  onChange,
  onRemove,
}: {
  pattern: WorkingPattern;
  badge: string;
  canRemove: boolean;
  onChange(p: WorkingPattern): void;
  onRemove(): void;
}) {
  const setDay = (d: keyof WeekPattern, ranges: TimeRange[]) =>
    onChange({ ...pattern, week: { ...pattern.week, [d]: ranges } });
  return (
    <div className="glass-pane flex flex-col gap-2 p-3" aria-label={`Working pattern ${badge}`} role="group">
      <div className="flex items-center gap-2">
        <Badge tone={badge === 'Now' ? 'accent' : 'neutral'}>{badge}</Badge>
        {pattern.validFrom > '2000-01-01' ? (
          <span className="text-[12px] text-orv-muted">starts {fmtDate(pattern.validFrom)}</span>
        ) : null}
        {canRemove ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      {WEEKDAYS.map((d) => (
        <div key={d} className="grid grid-cols-[44px_1fr] items-center gap-2">
          <span className="text-[13px] font-medium">{DAY_NAMES[d]}</span>
          <Ranges label={`${badge} ${DAY_NAMES[d]}`} value={pattern.week[d]} onChange={(r) => setDay(d, r)} />
        </div>
      ))}
    </div>
  );
}

function NewPattern({
  existing,
  from,
  onAdd,
}: {
  existing: string[];
  from: WorkingPattern;
  onAdd(p: WorkingPattern): void;
}) {
  const [date, setDate] = useState('');
  const taken = existing.includes(date);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Hours change from">
        {(id) => (
          <Input
            id={id}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        )}
      </Field>
      <Button
        disabled={!date || taken}
        onClick={() => {
          onAdd({ validFrom: date, week: structuredClone(from.week) });
          setDate('');
        }}
      >
        <CalendarClock size={14} /> Add a new pattern
      </Button>
      {taken ? (
        <span className="pb-3 text-small text-orv-muted">A pattern already starts that day.</span>
      ) : null}
    </div>
  );
}

function DayOverrides({
  value,
  onChange,
}: {
  value: TodaySettingsFields['dayOverrides'];
  onChange(v: TodaySettingsFields['dayOverrides']): void;
}) {
  const [date, setDate] = useState('');
  const today = localDay(new Date());
  const upcoming = [...value].filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex flex-col gap-2">
      <Label>Days that are different</Label>
      {upcoming.map((d) => (
        <div key={d.date} className="glass-pane flex flex-wrap items-center gap-3 p-2.5">
          <span className="w-32 text-[13px] font-medium">{fmtDate(d.date)}</span>
          <Ranges
            label={fmtDate(d.date)}
            value={d.ranges}
            onChange={(ranges) => onChange(value.map((x) => (x.date === d.date ? { ...x, ranges } : x)))}
          />
          <button
            aria-label={`Remove ${fmtDate(d.date)}`}
            onClick={() => onChange(value.filter((x) => x.date !== d.date))}
            className="ml-auto rounded-full p-1 text-orv-muted hover:bg-orv-track"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date">
          {(id) => (
            <Input
              id={id}
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          )}
        </Field>
        <Button
          disabled={!date || value.some((d) => d.date === date)}
          onClick={() => {
            onChange([...value, { date, ranges: [] }]);
            setDate('');
          }}
        >
          Day off
        </Button>
        <Button
          disabled={!date || value.some((d) => d.date === date)}
          onClick={() => {
            onChange([...value, { date, ranges: [{ start: '10:00', end: '14:00' }] }]);
            setDate('');
          }}
        >
          Different hours
        </Button>
      </div>
    </div>
  );
}

export function LeadTimes({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange(v: number[]): void;
}) {
  const [custom, setCustom] = useState('');
  const add = (m: number) =>
    !value.includes(m) && value.length < 5 && onChange([...value, m].sort((a, b) => b - a));
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-small font-medium text-orv-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {value.length === 0 ? <span className="text-small text-orv-muted">No reminder</span> : null}
        {value.map((m) => (
          <span
            key={m}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white [background:var(--orv-accent-grad)]"
          >
            {leadLabel(m)}
            <button
              aria-label={`Remove ${leadLabel(m)}`}
              onClick={() => onChange(value.filter((x) => x !== m))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <select
          aria-label={`Add a reminder (${label})`}
          value=""
          onChange={(e) => e.target.value && add(Number(e.target.value))}
          className="h-8 rounded-full border border-orv-edge bg-orv-field px-2 text-[12px]"
        >
          <option value="">+ add</option>
          {[0, ...LEAD_CHOICES]
            .filter((m) => !value.includes(m))
            .map((m) => (
              <option key={m} value={m}>
                {leadLabel(m)}
              </option>
            ))}
        </select>
        <input
          aria-label={`Custom minutes (${label})`}
          inputMode="numeric"
          placeholder="min"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom) {
              add(Math.min(20160, Number(custom)));
              setCustom('');
            }
          }}
          className="h-8 w-16 rounded-full border border-orv-edge bg-orv-field px-2 text-[12px]"
        />
      </div>
    </div>
  );
}
