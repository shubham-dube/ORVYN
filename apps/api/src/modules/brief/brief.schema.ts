import type { BriefSettings, BriefView } from '@orvyn/contracts';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';

/** The Brief (spec 0009). Server-side only; every query is the person's own. */
export const briefSettings = pgTable('brief_settings', {
  ownerId: uuid('owner_id').primaryKey(),
  settings: jsonb('settings').$type<BriefSettings>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One Brief a day per person: what it said, and when it was sent. */
export const briefs = pgTable(
  'briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    day: text('day').notNull(),
    content: jsonb('content').$type<BriefView>().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('briefs_owner_day_uq').on(t.ownerId, t.day)],
);

/** Nudges sent: the daily cap counts these, and a reason is never nudged twice. */
export const briefNudges = pgTable(
  'brief_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    day: text('day').notNull(),
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('brief_nudges_reason_uq').on(t.ownerId, t.reason),
    index('brief_nudges_day_idx').on(t.ownerId, t.day),
  ],
);
