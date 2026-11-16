import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from '../../db/columns';
import { users } from '../auth/auth.schema';

/** Per-person feature switches (ADR-0005). The owner implicitly has every key. */
export const entitlements = pgTable(
  'entitlements',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);

export const invites = pgTable(
  'invites',
  {
    id: pk(),
    tokenHash: text('token_hash').notNull(),
    email: text('email'),
    entitlements: text('entitlements')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('invites_token_uq').on(t.tokenHash), index('invites_creator_idx').on(t.createdBy)],
);
