import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, ts, updatedAt } from '../../db/columns';

/** Chat (spec 0011, ADR-0014): who talks to whom and ciphertext — never what. */

/** A device's public keys (the secrets never leave it). Kept after revocation so old signatures still check. */
export const chatDevices = pgTable(
  'chat_devices',
  {
    deviceId: uuid('device_id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    boxPublic: text('box_public').notNull(),
    signPublic: text('sign_public').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chat_devices_owner_idx').on(t.ownerId)],
);

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['direct', 'group'] }).notNull(),
    title: text('title').notNull().default(''),
    adminId: uuid('admin_id'),
    /** direct chats: "<smaller id>:<larger id>", so there is one per pair */
    pairKey: text('pair_key'),
    splitGroupId: uuid('split_group_id'),
    /** one message pinned to the top of the chat (spec 0015) */
    pinnedMessageId: uuid('pinned_message_id'),
    lastAt: ts('last_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('chat_conversations_pair_uq').on(t.pairKey)],
);

/** Membership is the sharing object (rule 5): every read checks it. */
export const chatMembers = pgTable(
  'chat_members',
  {
    conversationId: uuid('conversation_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    muted: boolean('muted').notNull().default(false),
    lastReadAt: ts('last_read_at'),
    /** the newest moment this person's app had everything (✓✓ delivered) */
    lastDeliveredAt: ts('last_delivered_at'),
    /** pinned to the top of their list */
    pinned: boolean('pinned').notNull().default(false),
    joinedAt: createdAt(),
    leftAt: ts('left_at'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.ownerId] }),
    index('chat_members_owner_idx').on(t.ownerId),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    senderDeviceId: uuid('sender_device_id'),
    kind: text('kind', { enum: ['msg', 'system'] })
      .notNull()
      .default('msg'),
    ciphertext: text('ciphertext'),
    nonce: text('nonce'),
    signature: text('signature'),
    /** system lines only (not encrypted, marked so) */
    text: text('text'),
    files: jsonb('files').$type<string[]>().notNull().default([]),
    /** 1: sealed per device (ADR-0014). 2: kept here, encrypted at rest (ADR-0016) */
    v: smallint('v').notNull().default(1),
    /** v2: text, attachments and share as one sealed JSON object (never readable from the database alone) */
    body: text('body'),
    replyToId: uuid('reply_to_id'),
    forwarded: boolean('forwarded').notNull().default(false),
    /** whose uploads the attachments are (a forward keeps the original sender's); null = the sender */
    filesOwnerId: uuid('files_owner_id'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_conv_idx').on(t.conversationId, t.createdAt)],
);

/** One row per recipient device: the message key sealed to that device. */
export const chatKeys = pgTable(
  'chat_keys',
  {
    messageId: uuid('message_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    sealed: text('sealed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.deviceId] })],
);

/** One reaction per person per message (D-0015-4). */
export const chatReactions = pgTable(
  'chat_reactions',
  {
    messageId: uuid('message_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.ownerId] })],
);

/** "Delete for me": hidden for this person only. */
export const chatHidden = pgTable(
  'chat_hidden',
  {
    messageId: uuid('message_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.ownerId] }), index('chat_hidden_owner_idx').on(t.ownerId)],
);
