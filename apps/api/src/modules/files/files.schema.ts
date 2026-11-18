import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Uploaded files (ADR-0011): bytes encrypted in the object store; only the wrapped data key is here. */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    /** data key sealed with FILES_MASTER_KEY */
    wrappedKey: text('wrapped_key').notNull(),
    objectKey: text('object_key').notNull(),
    /** which module it belongs to (drop, money…) */
    purpose: text('purpose').notNull().default('drop'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('files_owner_idx').on(t.ownerId)],
);
