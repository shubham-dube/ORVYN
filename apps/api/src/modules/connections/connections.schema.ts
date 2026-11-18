import { jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';

/**
 * Accounts of other services connected with a personal token (spec 0007 C2: ClickUp, more later). Several per
 * provider. The token is stored only sealed (TokenBox), like Google's; never sent to clients or logs.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    provider: text('provider').notNull(),
    /** who it is on that service (email or name) */
    label: text('label').notNull(),
    externalId: text('external_id').notNull(),
    secretEnc: text('secret_enc').notNull(),
    status: text('status').notNull().default('active'),
    lastError: text('last_error'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('connections_owner_provider_ext_uq').on(t.ownerId, t.provider, t.externalId)],
);
