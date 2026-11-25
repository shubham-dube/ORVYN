import type { ActivityRules } from '@orvyn/contracts';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';
import { users } from '../auth/auth.schema';

/** The activity record (ADR-0018): times in the clear for queries, everything else sealed per person. */
export const activitySpans = pgTable(
  'activity_spans',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').notNull(),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    sealed: text('sealed').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('activity_spans_owner_start_idx').on(t.ownerId, t.startAt)],
);

export const activityRules = pgTable('activity_rules', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  rules: jsonb('rules').$type<ActivityRules>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
