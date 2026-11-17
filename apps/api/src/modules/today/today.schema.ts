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
