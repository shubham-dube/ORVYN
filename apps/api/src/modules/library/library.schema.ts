import { bigint, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Library documents and notes (spec 0004). Readable by the AI (D26). Owner-scoped. */
export const libraryDocs = pgTable(
  'library_docs',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    kind: text('kind').notNull().default('file'),
    title: text('title').notNull().default(''),
    category: text('category').notNull().default('Other'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    summary: text('summary').notNull().default(''),
    text: text('text').notNull().default(''),
    fileId: uuid('file_id'),
    fileName: text('file_name').notNull().default(''),
    mime: text('mime').notNull().default(''),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('ready'),
    problem: text('problem'),
    keyDates: jsonb('key_dates').$type<unknown[]>().notNull().default([]),
    amounts: jsonb('amounts').$type<unknown[]>().notNull().default([]),
    expiresOn: text('expires_on'),
    remind: boolean('remind').notNull().default(true),
    moneyState: text('money_state').notNull().default('none'),
    source: text('source').notNull().default('web'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('library_docs_owner_idx').on(t.ownerId, t.createdAt),
    index('library_docs_expiry_idx').on(t.expiresOn),
  ],
);
