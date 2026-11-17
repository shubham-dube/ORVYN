import { z } from 'zod';

/**
 * Today (spec 0002): the writable fields of synced entities. Clients send only changed fields; the API validates
 * them against these and merges per field (ADR-0006). Times are ISO-8601 strings with offset; dates are YYYY-MM-DD.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().datetime({ offset: true });
const timeZone = z.string().min(1).max(64);

export const TODAY_PROJECT = 'today.project';
export const TODAY_TASK = 'today.task';

export const PROJECT_COLOURS = [
  'sky',
  'emerald',
  'amber',
  'violet',
  'coral',
  'gold',
  'cyan',
  'slate',
] as const;

export const ProjectFields = z.object({
  name: z.string().trim().min(1).max(80),
  colour: z.enum(PROJECT_COLOURS).default('sky'),
  order: z.number().int().min(0).max(1_000_000).default(0),
  archived: z.boolean().default(false),
});
export type ProjectFields = z.infer<typeof ProjectFields>;

export const ChecklistItem = z.object({
  id: z.string().min(1).max(40),
  text: z.string().max(300),
  done: z.boolean(),
});

/** Minutes before the moment (offset) or an exact time. */
export const Reminder = z.union([
  z.object({
    kind: z.literal('before'),
    minutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 14),
  }),
  z.object({ kind: z.literal('at'), at: isoDateTime }),
]);

export const TaskFields = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).default(''),
  checklist: z.array(ChecklistItem).max(100).default([]),
  projectId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** 0 none · 1 low · 2 medium · 3 high */
  priority: z.number().int().min(0).max(3).default(0),
  /** a day, or a moment */
  dueDate: isoDate.nullable().default(null),
  dueAt: isoDateTime.nullable().default(null),
  /** a time block on the river */
  scheduledStart: isoDateTime.nullable().default(null),
  durationMin: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .nullable()
    .default(null),
  timeZone: timeZone.default('Asia/Kolkata'),
  /** RFC 5545 RRULE body, e.g. "FREQ=MONTHLY;BYMONTHDAY=1" */
  rrule: z.string().max(500).nullable().default(null),
  /** null = use my defaults (D17); [] = no reminder for this task; otherwise exactly these */
  reminders: z.array(Reminder).max(10).nullable().default(null),
  completedAt: isoDateTime.nullable().default(null),
  /** a repeating task never stays done: it moves to its next time and remembers when it was last done */
  lastDoneAt: isoDateTime.nullable().default(null),
  /** how it was created: typed, spoken, orb, email … (analytics-free; shown in the task sheet) */
  source: z.string().max(20).default('typed'),
});
export type TaskFields = z.infer<typeof TaskFields>;

export type Task = TaskFields & { id: string };
export type Project = ProjectFields & { id: string };

// ------------------------------------------------------------------ the person's own settings (D15–D17)

export const TODAY_SETTINGS = 'today.settings';
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const TimeRange = z.object({ start: hhmm, end: hhmm }).refine((r) => toMin(r.start) < toMin(r.end), {
  message: 'a range must end after it starts',
});
export type TimeRange = z.infer<typeof TimeRange>;

/** Ranges for one day: in order, not overlapping. */
const DayRanges = z
  .array(TimeRange)
  .max(8)
  .refine((rs) => rs.every((r, i) => i === 0 || toMin(rs[i - 1]!.end) <= toMin(r.start)), {
    message: 'ranges must be in order and not overlap',
  });

export const WeekPattern = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, DayRanges])) as Record<Weekday, typeof DayRanges>,
);
export type WeekPattern = z.infer<typeof WeekPattern>;

/** A week that applies from `validFrom` until the next pattern starts. */
export const WorkingPattern = z.object({ validFrom: isoDate, week: WeekPattern });
export type WorkingPattern = z.infer<typeof WorkingPattern>;

/** One date that doesn't follow the pattern (`ranges: []` = a day off). */
export const DayOverride = z.object({
  date: isoDate,
  ranges: DayRanges,
  note: z.string().max(80).optional(),
});
export type DayOverride = z.infer<typeof DayOverride>;

export const DateOnlyReminder = z.discriminatedUnion('mode', [
  /** one summary of everything due that day */
  z.object({ mode: z.literal('digest'), at: hhmm }),
  /** a separate notification per task */
  z.object({ mode: z.literal('ping'), at: hhmm }),
  z.object({ mode: z.literal('none') }),
]);

export const ReminderDefaults = z.object({
  /** minutes before timed tasks/events, any number (e.g. [1440, 10]) */
  timed: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(60 * 24 * 14),
    )
    .max(5),
  dateOnly: DateOnlyReminder,
  overdueInDigest: z.boolean(),
});
export type ReminderDefaults = z.infer<typeof ReminderDefaults>;

const tenToSeven = [{ start: '10:00', end: '19:00' }];
/** Only a starting point the person edits on first use — every value is theirs to change (D16, D17). */
export const STARTING_SETTINGS = {
  patterns: [
    {
      validFrom: '2000-01-01',
      week: {
        mon: tenToSeven,
        tue: tenToSeven,
        wed: tenToSeven,
        thu: tenToSeven,
        fri: tenToSeven,
        sat: [],
        sun: [],
      },
    },
  ],
  dayOverrides: [],
  bufferMin: 15,
  noPlanAfter: '22:00',
  timeZone: 'Asia/Kolkata',
  reminders: { timed: [10], dateOnly: { mode: 'digest', at: '09:00' }, overdueInDigest: true },
} satisfies Omit<TodaySettingsFields, 'patterns'> & { patterns: WorkingPattern[] };

export const TodaySettingsFields = z.object({
  patterns: z
    .array(WorkingPattern)
    .min(1)
    .max(50)
    .refine((ps) => new Set(ps.map((p) => p.validFrom)).size === ps.length, {
      message: 'one pattern per start date',
    }),
  dayOverrides: z
    .array(DayOverride)
    .max(400)
    .refine((ds) => new Set(ds.map((d) => d.date)).size === ds.length, { message: 'one override per date' }),
  bufferMin: z.number().int().min(0).max(120),
  noPlanAfter: hhmm,
  timeZone: z.string().min(1).max(64),
  reminders: ReminderDefaults,
});
export type TodaySettingsFields = z.infer<typeof TodaySettingsFields>;

/** Working ranges on a date: a day override wins; else the latest pattern that has started by then. */
export function workingRangesOn(
  s: Pick<TodaySettingsFields, 'patterns' | 'dayOverrides'>,
  date: string,
): TimeRange[] {
  const o = s.dayOverrides.find((d) => d.date === date);
  if (o) return o.ranges;
  const p = [...s.patterns]
    .filter((x) => x.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
  if (!p) return [];
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return p.week[WEEKDAYS[(day + 6) % 7]!];
}

/** A task's own reminders, else the person's defaults: minutes-before for timed tasks; null for date-only (digest/ping handles those). */
export function effectiveReminders(
  task: Pick<TaskFields, 'reminders' | 'dueAt' | 'scheduledStart' | 'dueDate'>,
  defaults: ReminderDefaults,
): { before: number[]; at: string[] } {
  if (task.reminders !== null) {
    return {
      before: task.reminders.flatMap((r) => (r.kind === 'before' ? [r.minutes] : [])),
      at: task.reminders.flatMap((r) => (r.kind === 'at' ? [r.at] : [])),
    };
  }
  return task.dueAt || task.scheduledStart ? { before: defaults.timed, at: [] } : { before: [], at: [] };
}

// ------------------------------------------------------------------ natural language (spec 0002 M2)

export const ParseRequest = z.object({
  text: z.string().min(1).max(500),
  /** defaults to the person's Today time zone */
  timeZone: z.string().min(1).max(64).optional(),
  /** chips the person removed: [start, end) ranges to read literally */
  literal: z
    .array(z.tuple([z.number().int().min(0).max(500), z.number().int().min(0).max(500)]))
    .max(20)
    .optional(),
});
export type ParseRequest = z.infer<typeof ParseRequest>;

// ------------------------------------------------------------------ calendars and events (M4, M5)

export const TODAY_CALENDAR = 'today.calendar';
export const TODAY_EVENT = 'today.event';

/**
 * A calendar: ORVYN's own, or one from a connected Google account (D15: several accounts per person). Google
 * calendars are created and kept current by the server; the person only switches them on/off and recolours them.
 */
export const CalendarFields = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['orvyn', 'google']).default('orvyn'),
  /** the connected account (calendar_accounts.id) for provider google */
  accountId: z.string().uuid().nullable().default(null),
  /** the provider's id for this calendar */
  externalId: z.string().max(300).nullable().default(null),
  colour: z.enum(PROJECT_COLOURS).default('sky'),
  visible: z.boolean().default(true),
  writable: z.boolean().default(true),
  /** where new events go when none is chosen */
  primary: z.boolean().default(false),
});
export type CalendarFields = z.infer<typeof CalendarFields>;
export type Calendar = CalendarFields & { id: string };

/**
 * An event. Timed events use `start`/`end` (instants); all-day events use `startDate`/`endDate` (end exclusive,
 * like iCalendar). A repeating event has `rrule` and `exdates` (cancelled occurrences, as the occurrence's ISO
 * start or its date). A changed occurrence is its own event pointing back with `recurringEventId` +
 * `originalStart`; expanding the series skips that occurrence.
 */
export const EventFields = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).default(''),
  location: z.string().max(500).default(''),
  allDay: z.boolean().default(false),
  start: isoDateTime.nullable().default(null),
  end: isoDateTime.nullable().default(null),
  startDate: isoDate.nullable().default(null),
  endDate: isoDate.nullable().default(null),
  timeZone: timeZone.default('Asia/Kolkata'),
  rrule: z.string().max(500).nullable().default(null),
  exdates: z.array(z.string().max(40)).max(1000).default([]),
  recurringEventId: z.string().uuid().nullable().default(null),
  originalStart: z.string().max(40).nullable().default(null),
  /** a cancelled single occurrence of a provider series (kept so it isn't re-created) */
  cancelled: z.boolean().default(false),
  calendarId: z.string().uuid().nullable().default(null),
  /** the provider's ids, set by the server's calendar sync */
  externalId: z.string().max(1024).nullable().default(null),
  etag: z.string().max(200).nullable().default(null),
  /** a task this time block was made from (drag to the river) */
  taskId: z.string().uuid().nullable().default(null),
});
export type EventFields = z.infer<typeof EventFields>;
export type CalEvent = EventFields & { id: string };

/** Checks the shape rules zod can't express per field (used by the API and the clients' forms). */
export function eventProblem(e: Partial<EventFields>): string | null {
  if (e.allDay) {
    if (!e.startDate || !e.endDate) return 'an all-day event needs a start and end date';
    if (e.endDate <= e.startDate) return 'an all-day event must end after it starts';
  } else {
    if (!e.start || !e.end) return 'an event needs a start and end time';
    if (Date.parse(e.end) <= Date.parse(e.start)) return 'an event must end after it starts';
  }
  return null;
}

/** POST /today/plan: preview a day plan (nothing is changed until the person accepts). */
export const PlanRequest = z.object({ date: isoDate });
export type PlanRequest = z.infer<typeof PlanRequest>;
