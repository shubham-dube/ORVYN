'use client';

import {
  buildRepeat,
  defaultSpec,
  describeSpec,
  nextDates,
  parseRepeat,
  type RepeatSpec,
  specFor,
  WEEKDAYS,
  type Weekday,
} from '@orvyn/today-plan';
import { useMemo } from 'react';
import { Segmented } from '@/components/ui/bits';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';

const DAY: Record<Weekday, string> = { MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S' };
const FULL: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};
const UNITS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;
const select =
  'h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px] text-orv-text';

const shortDate = (d: string, tz: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return (
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, day))) + (tz ? '' : '')
  );
};

/**
 * One repeat builder for everything that repeats (tasks, events, scheduled money): "never / every day / week / month /
 * year", every N, which weekdays, which day of the month, when it ends — with a plain summary and the next dates, so a
 * rule is never a surprise. `value` is an RRULE ('' = doesn't repeat).
 */
export function RepeatBuilder({
  value,
  onChange,
  startDate,
  timeZone,
  allowNone = true,
}: {
  value: string;
  onChange(rrule: string): void;
  startDate: string;
  timeZone: string;
  allowNone?: boolean;
}) {
  const spec = useMemo(() => (value ? parseRepeat(value) : null), [value]);
  const custom = !!value && !spec; // a rule the builder can't show: keep it as it is
  const set = (s: RepeatSpec) => onChange(buildRepeat(s));
  const preview = useMemo(
    () => (value ? nextDates(value, startDate, 5, timeZone) : []),
    [value, startDate, timeZone],
  );
  const freq = custom ? 'CUSTOM' : (spec?.freq ?? 'NONE');

  return (
    <div className="flex flex-col gap-3" data-testid="repeat-builder">
      <Segmented
        label="Repeat"
        value={freq}
        onChange={(v) => {
          if (v === 'NONE') onChange('');
          else if (v !== 'CUSTOM') set(specFor(v as RepeatSpec['freq'], startDate));
        }}
        options={[
          ...(allowNone ? [{ value: 'NONE', label: 'Never' }] : []),
          { value: 'DAILY', label: 'Daily' },
          { value: 'WEEKLY', label: 'Weekly' },
          { value: 'MONTHLY', label: 'Monthly' },
          { value: 'YEARLY', label: 'Yearly' },
          ...(custom ? [{ value: 'CUSTOM', label: 'Custom' }] : []),
        ]}
      />
      {spec ? (
        <>
          <div className="flex items-end gap-2">
            <Field label={`Every`}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  value={spec.interval}
                  className="w-24"
                  onChange={(e) =>
                    set({
                      ...spec,
                      interval: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
                    })
                  }
                />
              )}
            </Field>
            <span className="pb-3 text-[14px] text-orv-muted">
              {UNITS[spec.freq]}
              {spec.interval > 1 ? 's' : ''}
            </span>
          </div>

          {spec.freq === 'WEEKLY' ? (
            <div role="group" aria-label="On these days" className="flex gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = spec.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={FULL[d]}
                    onClick={() => {
                      const next = on ? spec.weekdays.filter((x) => x !== d) : [...spec.weekdays, d];
                      if (next.length) set({ ...spec, weekdays: next });
                    }}
                    className={cn(
                      'grid size-10 place-items-center rounded-full border text-[13px] font-medium transition-colors',
                      on
                        ? 'border-transparent bg-orv-accent text-white'
                        : 'border-orv-edge text-orv-muted hover:bg-orv-track',
                    )}
                  >
                    {DAY[d]}
                  </button>
                );
              })}
            </div>
          ) : null}

          {spec.freq === 'MONTHLY' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="On">
                {(id) => (
                  <select
                    id={id}
                    className={select}
                    value={spec.monthly.kind}
                    onChange={(e) =>
                      set({
                        ...spec,
                        monthly:
                          e.target.value === 'day'
                            ? { kind: 'day', day: Number(startDate.slice(8, 10)) }
                            : { kind: 'nth', n: 1, weekday: 'MO' },
                      })
                    }
                  >
                    <option value="day">a date</option>
                    <option value="nth">a weekday</option>
                  </select>
                )}
              </Field>
              {spec.monthly.kind === 'day' ? (
                <Field label="Date">
                  {(id) => (
                    <select
                      id={id}
                      className={select}
                      value={spec.monthly.kind === 'day' ? spec.monthly.day : 1}
                      onChange={(e) =>
                        set({ ...spec, monthly: { kind: 'day', day: Number(e.target.value) } })
                      }
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      <option value={-1}>Last day</option>
                    </select>
                  )}
                </Field>
              ) : (
                <Field label="Which">
                  {(id) => {
                    const m = spec.monthly as { kind: 'nth'; n: number; weekday: Weekday };
                    return (
                      <div className="flex gap-2">
                        <select
                          id={id}
                          className={select}
                          value={m.n}
                          onChange={(e) => set({ ...spec, monthly: { ...m, n: Number(e.target.value) } })}
                        >
                          {[1, 2, 3, 4, -1].map((n) => (
                            <option key={n} value={n}>
                              {n === -1 ? 'last' : ['', '1st', '2nd', '3rd', '4th'][n]}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Weekday"
                          className={select}
                          value={m.weekday}
                          onChange={(e) =>
                            set({ ...spec, monthly: { ...m, weekday: e.target.value as Weekday } })
                          }
                        >
                          {WEEKDAYS.map((d) => (
                            <option key={d} value={d}>
                              {FULL[d]}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }}
                </Field>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Ends">
              {(id) => (
                <select
                  id={id}
                  className={select}
                  value={spec.end.kind}
                  onChange={(e) => {
                    const k = e.target.value;
                    set({
                      ...spec,
                      end:
                        k === 'never'
                          ? { kind: 'never' }
                          : k === 'count'
                            ? { kind: 'count', count: 10 }
                            : { kind: 'until', date: lastOfYear(startDate) },
                    });
                  }}
                >
                  <option value="never">Never</option>
                  <option value="until">On a date</option>
                  <option value="count">After some times</option>
                </select>
              )}
            </Field>
            {spec.end.kind === 'until' ? (
              <Field label="Last day">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    min={startDate}
                    value={spec.end.kind === 'until' ? spec.end.date : ''}
                    onChange={(e) =>
                      e.target.value && set({ ...spec, end: { kind: 'until', date: e.target.value } })
                    }
                  />
                )}
              </Field>
            ) : null}
            {spec.end.kind === 'count' ? (
              <Field label="Times">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={999}
                    value={spec.end.kind === 'count' ? spec.end.count : 1}
                    onChange={(e) =>
                      set({
                        ...spec,
                        end: {
                          kind: 'count',
                          count: Math.min(999, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
                        },
                      })
                    }
                  />
                )}
              </Field>
            ) : null}
          </div>
        </>
      ) : null}

      {value ? (
        <div className="rounded-orv-md bg-orv-track px-3 py-2 text-[13px]" aria-live="polite">
          <p className="font-medium">{spec ? describeSpec(spec) : 'Custom repeat (set elsewhere)'}</p>
          {preview.length ? (
            <p className="text-orv-muted">Next: {preview.map((d) => shortDate(d, timeZone)).join(' · ')}</p>
          ) : (
            <p className="text-orv-muted">No dates yet from {startDate}.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const lastOfYear = (d: string) => `${d.slice(0, 4)}-12-31`;

export { defaultSpec };
