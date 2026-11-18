import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Today (spec 0002). Rows are written only through the sync engine; every query is owner-scoped. */
export const todayProjects = pgTable(
  'today_projects',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    colour: text('colour').notNull().default('sky'),
    order: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('today_projects_owner_idx').on(t.ownerId)],
);

/** Saved task searches ("Work, urgent, this week"), the same on every device. */
export const todayFilters = pgTable(
  'today_filters',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    text: text('text').notNull().default(''),
    projectId: text('project_id'),
    tag: text('tag'),
    minPriority: integer('min_priority').notNull().default(0),
    when: text('when').notNull().default('any'),
    order: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('today_filters_owner_idx').on(t.ownerId)],
);

export const todayTasks = pgTable(
  'today_tasks',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    checklist: jsonb('checklist')
      .$type<{ id: string; text: string; done: boolean }[]>()
      .notNull()
      .default([]),
    projectId: uuid('project_id'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priority: integer('priority').notNull().default(0),
    dueDate: text('due_date'),
    dueAt: ts('due_at'),
    scheduledStart: ts('scheduled_start'),
    durationMin: integer('duration_min'),
    timeZone: text('time_zone').notNull().default('Asia/Kolkata'),
    rrule: text('rrule'),
    reminders: jsonb('reminders').$type<unknown[] | null>(),
    completedAt: ts('completed_at'),
    lastDoneAt: ts('last_done_at'),
    source: text('source').notNull().default('typed'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('today_tasks_owner_idx').on(t.ownerId),
    // the reminder scheduler and "today" queries
    index('today_tasks_owner_due_idx').on(t.ownerId, t.dueAt),
    index('today_tasks_owner_sched_idx').on(t.ownerId, t.scheduledStart),
  ],
);

/** One row per person: id = the person's id (D16, D17). */
export const todaySettings = pgTable('today_settings', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().unique(),
  patterns: jsonb('patterns').$type<unknown[]>().notNull(),
  dayOverrides: jsonb('day_overrides').$type<unknown[]>().notNull(),
  bufferMin: integer('buffer_min').notNull(),
  noPlanAfter: text('no_plan_after').notNull(),
  timeZone: text('time_zone').notNull(),
  reminders: jsonb('reminders').$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
});

/** Calendars: ORVYN's own, or one per Google calendar the person has switched on (D15). */
export const todayCalendars = pgTable(
  'today_calendars',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('orvyn'),
    accountId: uuid('account_id'),
    externalId: text('external_id'),
    colour: text('colour').notNull().default('sky'),
    visible: boolean('visible').notNull().default(true),
    writable: boolean('writable').notNull().default(true),
    primary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('today_calendars_owner_idx').on(t.ownerId)],
);

export const todayEvents = pgTable(
  'today_events',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    location: text('location').notNull().default(''),
    allDay: boolean('all_day').notNull().default(false),
    start: ts('start_at'),
    end: ts('end_at'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    timeZone: text('time_zone').notNull().default('Asia/Kolkata'),
    rrule: text('rrule'),
    exdates: text('exdates')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    recurringEventId: uuid('recurring_event_id'),
    originalStart: text('original_start'),
    cancelled: boolean('cancelled').notNull().default(false),
    calendarId: uuid('calendar_id'),
    externalId: text('external_id'),
    etag: text('etag'),
    taskId: uuid('task_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('today_events_owner_start_idx').on(t.ownerId, t.start),
    index('today_events_owner_cal_idx').on(t.ownerId, t.calendarId),
    // one row per provider event per calendar: reconnects never duplicate (AC3)
    index('today_events_cal_ext_idx').on(t.calendarId, t.externalId),
  ],
);
