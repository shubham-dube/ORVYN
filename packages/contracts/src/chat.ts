import { z } from 'zod';

/**
 * Chat (spec 0011 part A, spec 0015 C). New messages are kept on the server, encrypted at rest (ADR-0016), so every
 * device has the whole history. Older ones were sealed per device (ADR-0014) and are carried over when a device that
 * can read them opens the chat.
 */

const b64u = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const RegisterChatDevice = z.object({
  boxPublic: b64u.length(43),
  signPublic: b64u.length(43),
});
export type RegisterChatDevice = z.infer<typeof RegisterChatDevice>;

export const NewConversation = z.object({
  kind: z.enum(['direct', 'group']),
  memberIds: z.array(z.string().uuid()).min(1).max(49),
  title: z.string().trim().max(80).default(''),
});
export type NewConversation = z.infer<typeof NewConversation>;

export const SendMessage = z.object({
  /** made on the device (UUIDv7), so the signature can cover it */
  id: z.string().uuid(),
  ciphertext: b64u.max(90_000),
  nonce: b64u.length(32),
  signature: b64u.length(86),
  keys: z
    .array(z.object({ deviceId: z.string().uuid(), sealed: b64u.max(200) }))
    .min(1)
    .max(500),
  /** encrypted attachments uploaded first; listed so members may download them (the key is inside the message) */
  files: z.array(z.string().uuid()).max(10).default([]),
});
export type SendMessage = z.infer<typeof SendMessage>;

/** A photo or file sent in a chat (uploaded first through /files with purpose `chat-file`). */
export const ChatAttachment = z.object({
  fileId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  mime: z.string().max(120),
  size: z.number().int().min(0),
  /** photos: their size, so the bubble keeps its shape while loading */
  w: z.number().int().positive().max(20000).optional(),
  h: z.number().int().positive().max(20000).optional(),
});
export type ChatAttachment = z.infer<typeof ChatAttachment>;

export const ChatShareRef = z.object({
  kind: z.enum(['task', 'ipo', 'doc', 'split']),
  id: z.string().max(80),
  title: z.string().max(200),
  line: z.string().max(200).optional(),
});
export type ChatShareRef = z.infer<typeof ChatShareRef>;

/** A message as the app sends it (spec 0015): kept on the server, encrypted at rest. */
export const SendChatMessage = z
  .object({
    /** made on the device (UUIDv7): the same id twice is one message (retries) */
    id: z.string().uuid(),
    text: z.string().max(4000).default(''),
    replyTo: z.string().uuid().nullish(),
    attachments: z.array(ChatAttachment).max(10).default([]),
    share: ChatShareRef.nullish(),
    /** forwarding: the message to copy (text, photos and files go with it) */
    forwardOf: z.string().uuid().nullish(),
  })
  .refine((m) => m.text.trim() || m.attachments.length || m.share || m.forwardOf, {
    message: 'empty message',
  });
export type SendChatMessage = z.infer<typeof SendChatMessage>;

export const EditChatMessage = z.object({ text: z.string().trim().min(1).max(4000) });
export const ChatReaction = z.object({ emoji: z.string().min(1).max(16).nullable() });
export const CarryChatMessages = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), key: b64u.length(43) }))
    .min(1)
    .max(200),
});
export type CarryChatMessages = z.infer<typeof CarryChatMessages>;

export interface ChatReplyPreview {
  id: string;
  senderId: string;
  text: string;
  /** a photo or file without words */
  attachment: string | null;
  deleted: boolean;
}

/** A message as every member's device receives it. */
export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'msg' | 'system';
  /** 2: kept on the server (spec 0015). 1: sealed per device and not carried over yet (ADR-0014). */
  v: 1 | 2;
  /** the words (v2), or a system line */
  text: string | null;
  attachments: ChatAttachment[];
  share: ChatShareRef | null;
  replyTo: ChatReplyPreview | null;
  reactions: { emoji: string; by: string[] }[];
  forwarded: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  // ---- v1 only: what this device needs to read (and carry over) an old sealed message
  senderDeviceId: string | null;
  ciphertext: string | null;
  nonce: string | null;
  signature: string | null;
  sealedForMe: string | null;
  files: string[];
}

export interface ConversationView {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  adminId: string | null;
  members: {
    id: string;
    name: string;
    email: string;
    lastReadAt: string | null;
    lastDeliveredAt: string | null;
    online: boolean;
    lastSeenAt: string | null;
  }[];
  muted: boolean;
  /** pinned to the top of my list */
  pinned: boolean;
  unread: number;
  lastAt: string | null;
  splitGroupId: string | null;
  /** the newest line, for the list */
  last: {
    id: string;
    senderId: string;
    kind: 'msg' | 'system';
    text: string;
    attachment: string | null;
    deleted: boolean;
    at: string;
  } | null;
  pinnedMessage: { id: string; senderId: string; text: string; attachment: string | null } | null;
}

/** Inside an old sealed message (ADR-0014). */
export type ChatPayload =
  | { t: 'text'; text: string; replyTo?: string | null }
  | { t: 'react'; target: string; emoji: string | null }
  | { t: 'edit'; target: string; text: string }
  | {
      t: 'file';
      fileId: string;
      key: string;
      nonce: string;
      name: string;
      mime: string;
      size: number;
      caption?: string;
    }
  | { t: 'share'; ref: { kind: 'task' | 'ipo' | 'doc' | 'split'; id: string; title: string; line?: string } };
