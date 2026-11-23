import type { InboxAction, InboxCategory, InboxSettings } from '@orvyn/contracts';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/**
 * The smart inbox (spec 0017 B). Unread mail from the last 7 days, as read from each mailbox, with what ORVYN made of
 * it. Personal data like the Library (D-0017-7): owner-scoped, kept 14 days, OTP codes cut before anything is stored.
 */
export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    connectionId: text('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    account: text('account').notNull(),
    provider: text('provider').notNull(),
    fromName: text('from_name').notNull().default(''),
    fromEmail: text('from_email').notNull().default(''),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    at: ts('at'),
    url: text('url'),
    category: text('category').$type<InboxCategory>().notNull().default('update'),
    score: integer('score').notNull().default(30),
    summary: text('summary').notNull().default(''),
    why: text('why').notNull().default(''),
    action: text('action').$type<InboxAction>().notNull().default('none'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    dueDate: text('due_date'),
    /** new: unread in the mailbox · seen: no longer unread there · done: I dealt with it here */
    state: text('state', { enum: ['new', 'seen', 'done'] })
      .notNull()
      .default('new'),
    pinned: boolean('pinned').notNull().default(false),
    by: text('by', { enum: ['ai', 'rules'] })
      .notNull()
      .default('rules'),
    notifiedAt: ts('notified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('inbox_items_uq').on(t.ownerId, t.connectionId, t.externalId),
    index('inbox_items_owner_idx').on(t.ownerId, t.state),
  ],
);

/** VIP and Mute, taught per sender address (D-0017-5). */
export const inboxSenders = pgTable(
  'inbox_senders',
  {
    ownerId: uuid('owner_id').notNull(),
    email: text('email').notNull(),
    rule: text('rule', { enum: ['vip', 'mute'] }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.email] })],
);

export const inboxSettings = pgTable('inbox_settings', {
  ownerId: uuid('owner_id').primaryKey(),
  settings: jsonb('settings').$type<InboxSettings>().notNull(),
  /** the last catch-up and the important set it was written for */
  catchUp: text('catch_up'),
  catchUpKey: text('catch_up_key'),
  refreshedAt: ts('refreshed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
