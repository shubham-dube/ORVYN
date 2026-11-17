import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
