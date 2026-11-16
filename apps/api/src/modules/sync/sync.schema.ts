import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';

/** Every accepted change, in order. Clients pull everything after their cursor (ADR-0006). */
export const changeLog = pgTable(
  'change_log',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    data: jsonb('data').$type<Record<string, unknown> | null>(),
    hlc: text('hlc').notNull(),
    deviceId: uuid('device_id'),
    mutationId: uuid('mutation_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('change_log_owner_seq_idx').on(t.ownerId, t.seq),
    uniqueIndex('change_log_mutation_uq').on(t.mutationId),
  ],
);

/** Merge clocks per synced object: which HLC last wrote each field, and when it was deleted. */
export const syncMeta = pgTable(
  'sync_meta',
  {
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    fieldHlcs: jsonb('field_hlcs').$type<Record<string, string>>().notNull().default({}),
    deletedHlc: text('deleted_hlc'),
    lastSeq: bigint('last_seq', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.entity, t.entityId] }), index('sync_meta_owner_idx').on(t.ownerId)],
);
