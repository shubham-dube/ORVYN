import type { IpoDecision, IpoDetails, IpoSettings, IpoSubscription, ShareRule } from '@orvyn/contracts';
import {
  bigint,
  boolean,
  doublePrecision,
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

// ------------------------------------------------------------------ market data (public, no owner — ADR-0013)

export const ipoIssues = pgTable(
  'ipo_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    type: text('type', { enum: ['mainboard', 'sme'] }).notNull(),
    status: text('status', { enum: ['upcoming', 'open', 'closed', 'listed'] }).notNull(),
    openDate: text('open_date'),
    closeDate: text('close_date'),
    allotmentDate: text('allotment_date'),
    refundDate: text('refund_date'),
    listingDate: text('listing_date'),
    priceMin: doublePrecision('price_min'),
    priceMax: doublePrecision('price_max'),
    lotSize: integer('lot_size'),
    issueSizeCr: doublePrecision('issue_size_cr'),
    gmp: doublePrecision('gmp'),
    gmpUpdatedAt: ts('gmp_updated_at'),
    subscription: jsonb('subscription').$type<IpoSubscription>(),
    listingPrice: doublePrecision('listing_price'),
    // spec 0016: the calendar's other facts, and the detail endpoint's extras
    logo: text('logo'),
    minInvestment: doublePrecision('min_investment'),
    faceValue: doublePrecision('face_value'),
    listingOn: text('listing_on'),
    saleType: text('sale_type'),
    listingGainPct: doublePrecision('listing_gain_pct'),
    cmp: doublePrecision('cmp'),
    kostak: doublePrecision('kostak'),
    sauda: doublePrecision('sauda'),
    details: jsonb('details').$type<IpoDetails>(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    /** fields typed in by hand, which the feed must not overwrite */
    manual: jsonb('manual').$type<string[]>().notNull().default([]),
    detailAt: ts('detail_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ipo_issues_slug_uq').on(t.slug), index('ipo_issues_status_idx').on(t.status)],
);

/** GMP and subscription as they moved (ORVYN's own history, one row per change). */
export const ipoSnapshots = pgTable(
  'ipo_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id').notNull(),
    gmp: doublePrecision('gmp'),
    subscription: jsonb('subscription').$type<IpoSubscription>(),
    createdAt: createdAt(),
  },
  (t) => [index('ipo_snapshots_issue_idx').on(t.issueId, t.createdAt)],
);

// ------------------------------------------------------------------ the desk, per person

export const ipoStars = pgTable(
  'ipo_stars',
  { ownerId: uuid('owner_id').notNull(), issueId: uuid('issue_id').notNull(), createdAt: createdAt() },
  (t) => [primaryKey({ columns: [t.ownerId, t.issueId] })],
);

export const ipoSettings = pgTable('ipo_settings', {
  ownerId: uuid('owner_id').primaryKey(),
  settings: jsonb('settings').$type<IpoSettings>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Notifications sent, so each IPO and event pings once; `value` remembers the GMP % last told. */
export const ipoAlerts = pgTable(
  'ipo_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    issueId: uuid('issue_id'),
    day: text('day').notNull(),
    reason: text('reason').notNull(),
    value: doublePrecision('value'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ipo_alerts_reason_uq').on(t.ownerId, t.reason),
    index('ipo_alerts_day_idx').on(t.ownerId, t.day),
  ],
);

/** "Will you apply?" and how it went, per person and IPO (spec 0016 A5). */
export const ipoDecisions = pgTable(
  'ipo_decisions',
  {
    ownerId: uuid('owner_id').notNull(),
    issueId: uuid('issue_id').notNull(),
    decision: text('decision').$type<IpoDecision>().notNull(),
    /** the Today task "Apply for …" */
    taskId: uuid('task_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.issueId] })],
);

// ------------------------------------------------------------------ the Pool (owner's own)

export const ipoPartners = pgTable(
  'ipo_partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    upi: text('upi').notNull().default(''),
    relation: text('relation').notNull().default(''),
    categories: jsonb('categories').$type<string[]>().notNull().default(['retail']),
    share: jsonb('share').$type<ShareRule>().notNull(),
    active: boolean('active').notNull().default(true),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ipo_partners_owner_idx').on(t.ownerId)],
);

export const ipoSources = pgTable(
  'ipo_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['self', 'family', 'card', 'other'] }).notNull(),
    feePct: doublePrecision('fee_pct').notNull().default(0),
    repay: boolean('repay').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ipo_sources_owner_idx').on(t.ownerId)],
);

export const ipoRounds = pgTable(
  'ipo_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    issueId: uuid('issue_id').notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ipo_rounds_owner_idx').on(t.ownerId),
    uniqueIndex('ipo_rounds_issue_uq').on(t.ownerId, t.issueId),
  ],
);

export const ipoApplications = pgTable(
  'ipo_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    roundId: uuid('round_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    category: text('category', { enum: ['retail', 'snii'] }).notNull(),
    lots: integer('lots').notNull(),
    /** paise blocked for the bid */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('planned'),
    allottedLots: integer('allotted_lots'),
    soldPrice: doublePrecision('sold_price'),
    saleCostsMinor: bigint('sale_costs_minor', { mode: 'number' }).notNull().default(0),
    /** the partner's share, paise; null = by their rule */
    shareMinor: bigint('share_minor', { mode: 'number' }),
    /** who said so last: 'owner' or 'partner' */
    reportedBy: text('reported_by').notNull().default('owner'),
    appliedAt: ts('applied_at'),
    soldAt: ts('sold_at'),
    settledAt: ts('settled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ipo_applications_round_idx').on(t.roundId),
    uniqueIndex('ipo_applications_partner_uq').on(t.roundId, t.partnerId),
  ],
);

/** Every movement of money in the Pool; balances are sums of this (D-0010-2). Amounts in paise. */
export const ipoLedger = pgTable(
  'ipo_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    at: ts('at').notNull(),
    kind: text('kind', { enum: ['fund', 'return', 'repay', 'cost', 'share', 'adjust'] }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    sourceId: uuid('source_id'),
    partnerId: uuid('partner_id'),
    roundId: uuid('round_id'),
    applicationId: uuid('application_id'),
    /** adjust: in (+ to the partner's float) or out */
    direction: text('direction', { enum: ['in', 'out'] })
      .notNull()
      .default('in'),
    method: text('method').notNull().default('UPI'),
    note: text('note').notNull().default(''),
    /** a cost written automatically for this fund entry (card fee) */
    forEntryId: uuid('for_entry_id'),
    createdAt: createdAt(),
  },
  (t) => [index('ipo_ledger_owner_idx').on(t.ownerId, t.at)],
);

/** Partner links: only the token's hash is kept (ADR-0013). */
export const ipoLinks = pgTable(
  'ipo_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ipo_links_hash_uq').on(t.tokenHash), index('ipo_links_partner_idx').on(t.partnerId)],
);
