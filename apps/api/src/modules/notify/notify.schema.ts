import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from '../../db/columns';
import { devices, users } from '../auth/auth.schema';

export interface StoredAction {
  id: string;
  label: string;
  open?: string;
}

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    url: text('url'),
    actions: jsonb('actions').$type<StoredAction[]>().notNull().default([]),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] })
      .notNull()
      .default('normal'),
    dedupeKey: text('dedupe_key'),
    /** rings like an alarm where the device can (D22) */
    alarm: boolean('alarm').notNull().default(false),
    /** which ways beyond the in-app inbox (push is the default; email/whatsapp are copies) */
    via: jsonb('via').$type<{ push?: boolean; email?: boolean; whatsapp?: boolean } | null>(),
    /** hard notifications come back until acknowledged (D22) */
    repeatEveryMin: integer('repeat_every_min'),
    repeatLeft: integer('repeat_left').notNull().default(0),
    /** What it is about, for actions (e.g. "today.task:<id>"). Never shown, never pushed. */
    ref: text('ref'),
    /** Device that caused it (e.g. a new sign-in) — it is not pushed there. */
    sourceDeviceId: uuid('source_device_id'),
    readAt: ts('read_at'),
    dismissedAt: ts('dismissed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('notifications_owner_idx').on(t.ownerId, t.createdAt),
    uniqueIndex('notifications_dedupe_uq')
      .on(t.ownerId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/** Where a device receives pushes. */
export const pushTargets = pgTable(
  'push_targets',
  {
    id: pk(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['webpush', 'fcm'] }).notNull(),
    /** FCM token or Web Push endpoint */
    address: text('address').notNull(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string } | null>(),
    failures: integer('failures').notNull().default(0),
    disabledAt: ts('disabled_at'),
    /** the last delivery: sent / gone / failed / skipped, the service's words, and when */
    lastResult: text('last_result'),
    lastError: text('last_error'),
    lastAt: ts('last_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('push_targets_address_uq').on(t.address),
    index('push_targets_owner_idx').on(t.ownerId),
  ],
);

export const notifySettings = pgTable('notify_settings', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  quietHours: jsonb('quiet_hours').$type<{ start: string; end: string; timeZone: string } | null>(),
  emailFor: text('email_for')
    .array()
    .notNull()
    .default(sql`'{urgent}'::text[]`),
  mutedModules: text('muted_modules')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Where a person can be reached besides the apps (D23). The WhatsApp number counts only once confirmed. */
export const contactChannels = pgTable('contact_channels', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  whatsapp: text('whatsapp'),
  whatsappVerifiedAt: ts('whatsapp_verified_at'),
  /** HMAC of the code sent, never the code */
  verifyHash: text('verify_hash'),
  verifyExpiresAt: ts('verify_expires_at'),
  verifyAttempts: integer('verify_attempts').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
