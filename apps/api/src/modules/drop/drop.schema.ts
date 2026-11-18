import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Drop items (spec 0003). Devices create them; the server's worker writes the proposal. Owner-scoped. */
export const dropItems = pgTable(
  'drop_items',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    kind: text('kind').notNull().default('text'),
    text: text('text').notNull().default(''),
    fileId: uuid('file_id'),
    fileName: text('file_name'),
    url: text('url'),
    source: text('source').notNull().default('web'),
    status: text('status').notNull().default('new'),
    proposal: jsonb('proposal').$type<Record<string, unknown> | null>(),
    problem: text('problem'),
    resultRef: text('result_ref'),
    correction: jsonb('correction').$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('drop_items_owner_idx').on(t.ownerId, t.createdAt)],
);
