import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/**
 * The Vault (ADR-0004, spec 0004). Zero-knowledge: these tables hold strings the server cannot read — the wrapped vault
 * keys, and one opaque encrypted blob per item. No titles, kinds or field names are stored in readable form.
 */
export const vaultKeys = pgTable('vault_keys', {
  /** the person's own id: exactly one record each */
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().unique(),
  pass: text('pass').notNull(),
  recovery: text('recovery').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
});

export const vaultItems = pgTable(
  'vault_items',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    blob: text('blob').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('vault_items_owner_idx').on(t.ownerId)],
);
