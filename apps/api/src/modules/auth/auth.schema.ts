import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from '../../db/columns';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    avatarUrl: text('avatar_url'),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    disabled: boolean('disabled').notNull().default(false),
    lastSeenAt: ts('last_seen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_single_owner_uq')
      .on(t.role)
      .where(sql`${t.role} = 'owner'`),
  ],
);

/** A signed-in app instance. One device = one refresh-token family. */
export const devices = pgTable(
  'devices',
  {
    id: pk(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull().default('0.0.0'),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('devices_owner_idx').on(t.ownerId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: pk(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    /** Set when this token was exchanged for a new one; presenting it again = theft signal. */
    rotatedAt: ts('rotated_at'),
    /** given to replace one whose answer never arrived: a second such loss is treated as theft */
    replaced: boolean('replaced').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_device_idx').on(t.deviceId),
  ],
);

export const emailCodes = pgTable(
  'email_codes',
  {
    id: pk(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    ip: text('ip').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('email_codes_email_idx').on(t.email, t.createdAt)],
);

export const passkeys = pgTable(
  'passkeys',
  {
    /** base64url credential id */
    id: text('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    deviceType: text('device_type').notNull().default('singleDevice'),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull().default('Passkey'),
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('passkeys_owner_idx').on(t.ownerId)],
);
