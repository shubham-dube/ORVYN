import { z } from 'zod';

/** Chat (spec 0011 part A, ADR-0014). The server only ever sees ciphertext and per-device sealed keys. */

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

/** What a device receives: the message and only its own sealed key. */
export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string | null;
  kind: 'msg' | 'system';
  ciphertext: string | null;
  nonce: string | null;
  signature: string | null;
  sealedForMe: string | null;
  /** system lines are plain text, and marked as not encrypted */
  text: string | null;
  files: string[];
  deletedAt: string | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  adminId: string | null;
  members: { id: string; name: string; email: string; lastReadAt: string | null }[];
  muted: boolean;
  unread: number;
  lastAt: string | null;
  splitGroupId: string | null;
}

/** Inside the ciphertext (the server never sees these). */
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
