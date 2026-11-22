import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Money (spec 0003). Written only through the sync engine; every query is owner-scoped. Amounts in paise. */
export const moneyAccounts = pgTable(
  'money_accounts',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('bank'),
    last4: text('last4'),
    institution: text('institution'),
    currency: text('currency').notNull().default('INR'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('money_accounts_owner_idx').on(t.ownerId)],
);

export const moneyCategories = pgTable(
  'money_categories',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('expense'),
    icon: text('icon').notNull().default('circle'),
    colour: text('colour').notNull().default('sky'),
    order: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    slug: text('slug'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('money_categories_owner_idx').on(t.ownerId)],
);

export const moneyTransactions = pgTable(
  'money_transactions',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    direction: text('direction').notNull().default('debit'),
    occurredAt: ts('occurred_at').notNull(),
    merchant: text('merchant').notNull().default(''),
    rawMerchant: text('raw_merchant').notNull().default(''),
    categoryId: uuid('category_id'),
    accountId: uuid('account_id'),
    note: text('note').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: text('source').notNull().default('manual'),
    dedupeKey: text('dedupe_key'),
    refNo: text('ref_no'),
    transfer: boolean('transfer').notNull().default(false),
    reviewed: boolean('reviewed').notNull().default(true),
    receiptFileId: uuid('receipt_file_id'),
    dropItemId: uuid('drop_item_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('money_tx_owner_time_idx').on(t.ownerId, t.occurredAt),
    // one payment, one row (AC2): the same reference can't be recorded twice by one person
    uniqueIndex('money_tx_owner_dedupe_uq')
      .on(t.ownerId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.deletedAt} is null`),
  ],
);

export const moneyBudgets = pgTable(
  'money_budgets',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    categoryId: uuid('category_id'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    from: text('from_month').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('money_budgets_owner_idx').on(t.ownerId)],
);

/** Scheduled money (rent, subscriptions, salary…): the server adds each occurrence on its day, once. */
export const moneyRecurring = pgTable(
  'money_recurring',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    direction: text('direction').notNull().default('debit'),
    merchant: text('merchant').notNull().default(''),
    categoryId: uuid('category_id'),
    accountId: uuid('account_id'),
    note: text('note').notNull().default(''),
    rrule: text('rrule').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    time: text('time').notNull().default('09:00'),
    timeZone: text('time_zone').notNull().default('Asia/Kolkata'),
    mode: text('mode').notNull().default('add'),
    paused: boolean('paused').notNull().default(false),
    lastRunOn: text('last_run_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('money_recurring_owner_idx').on(t.ownerId)],
);

/**
 * What the person taught ORVYN about a merchant (spec 0007 C1): file it under a category, treat it as a transfer, or
 * skip it. Learned from their answers; used once they said "always" or answered the same way twice. Server-side
 * only; listed and removable from Money's settings.
 */
export const moneyMerchantRules = pgTable(
  'money_merchant_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    merchantKey: text('merchant_key').notNull(),
    merchant: text('merchant').notNull(),
    /** 'ask': the person removed what was learned — ask again, and don't file it from history either */
    action: text('action', { enum: ['category', 'transfer', 'ignore', 'ask'] }).notNull(),
    categoryId: uuid('category_id'),
    hits: integer('hits').notNull().default(1),
    always: boolean('always').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('money_rules_owner_merchant_uq').on(t.ownerId, t.merchantKey)],
);
