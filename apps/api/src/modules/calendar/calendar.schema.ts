import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/**
 * Connected calendar accounts (D15: several Google accounts per person). Tokens are stored only encrypted
 * (libsodium secretbox, key from the environment); they never reach clients, logs or analytics.
 */
export const calendarAccounts = pgTable(
  'calendar_accounts',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    provider: text('provider').notNull().default('google'),
    email: text('email').notNull(),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    accessTokenEnc: text('access_token_enc'),
    accessExpiresAt: ts('access_expires_at'),
    /** active · needs_reconnect (Google refused the refresh token) */
    status: text('status').notNull().default('active'),
    /** what Google granted (spec 0007 C2: Gmail is an optional add-on per account) */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastSyncedAt: ts('last_synced_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('calendar_accounts_owner_idx').on(t.ownerId),
    // the same Google account connected twice by one person is one row (reconnect, never a duplicate)
    uniqueIndex('calendar_accounts_owner_email_uq').on(t.ownerId, t.provider, t.email),
  ],
);

/** Per provider calendar: where incremental sync left off, and its push channel. */
export const calendarSyncState = pgTable('calendar_sync_state', {
  /** = today_calendars.id */
  calendarId: uuid('calendar_id').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  accountId: uuid('account_id').notNull(),
  externalId: text('external_id').notNull(),
  syncToken: text('sync_token'),
  channelId: text('channel_id'),
  channelResourceId: text('channel_resource_id'),
  channelExpiresAt: ts('channel_expires_at'),
  lastSyncedAt: ts('last_synced_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
