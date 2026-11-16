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
  reminders: z.array(Reminder).max(10).default([]),
  completedAt: isoDateTime.nullable().default(null),
  /** how it was created: typed, spoken, orb, email … (analytics-free; shown in the task sheet) */
  source: z.string().max(20).default('typed'),
});
export type TaskFields = z.infer<typeof TaskFields>;

export type Task = TaskFields & { id: string };
export type Project = ProjectFields & { id: string };
