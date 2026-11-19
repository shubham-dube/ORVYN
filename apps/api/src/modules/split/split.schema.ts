import { bigint, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Split (spec 0011, ADR-0015): shared groups; membership is the sharing object. Paise everywhere. */

export const splitGroups = pgTable('split_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** the admin (who made it) */
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('trip'),
  conversationId: uuid('conversation_id'),
  archivedAt: ts('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** ORVYN people (userId) or guests (name only). */
export const splitMembers = pgTable(
  'split_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    upi: text('upi').notNull().default(''),
    removedAt: ts('removed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('split_members_group_idx').on(t.groupId), index('split_members_user_idx').on(t.userId)],
);

export const splitExpenses = pgTable(
  'split_expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull(),
    addedBy: uuid('added_by').notNull(),
    title: text('title').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    category: text('category').notNull().default('other'),
    note: text('note').notNull().default(''),
    receiptFileId: uuid('receipt_file_id'),
    paid: jsonb('paid').$type<{ memberId: string; amount: number }[]>().notNull(),
    method: text('method').notNull(),
    among: jsonb('among').$type<{ memberId: string; value: number }[]>().notNull(),
    shares: jsonb('shares').$type<{ memberId: string; amount: number }[]>().notNull(),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('split_expenses_group_idx').on(t.groupId, t.date)],
);

export const splitSettlements = pgTable(
  'split_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull(),
    addedBy: uuid('added_by').notNull(),
    fromId: uuid('from_id').notNull(),
    toId: uuid('to_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    method: text('method').notNull().default('UPI'),
    date: text('date').notNull(),
    note: text('note').notNull().default(''),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('split_settlements_group_idx').on(t.groupId)],
);

/** What happened, in words, for the group's activity. */
export const splitActivity = pgTable(
  'split_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull(),
    actorId: uuid('actor_id'),
    text: text('text').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('split_activity_group_idx').on(t.groupId, t.createdAt)],
);

/** Guest links: only the token's hash (ADR-0015). */
export const splitLinks = pgTable(
  'split_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull(),
    memberId: uuid('member_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('split_links_hash_uq').on(t.tokenHash)],
);
