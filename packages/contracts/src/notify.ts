import { z } from 'zod';

export const NotificationAction = z.object({
  id: z.string().regex(/^[a-z0-9_.-]{1,40}$/),
  label: z.string().max(30),
  /** Opens the app at this path instead of running in the background. */
  open: z.string().max(300).optional(),
});

export const Priority = z.enum(['low', 'normal', 'high', 'urgent']);

export const NotificationView = z.object({
  id: z.string().uuid(),
  module: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable(),
  actions: z.array(NotificationAction),
  priority: Priority,
  createdAt: z.string(),
  readAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});
export type NotificationView = z.infer<typeof NotificationView>;

export const NotifySettings = z.object({
  quietHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      timeZone: z.string(),
    })
    .nullable(),
  emailFor: z.array(Priority).default(['urgent']),
  mutedModules: z.array(z.string()).default([]),
});
export type NotifySettings = z.infer<typeof NotifySettings>;

export const WebPushSubscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export const RegisterPushRequest = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('webpush'), subscription: WebPushSubscription }),
  z.object({ channel: z.literal('fcm'), token: z.string().min(20).max(4096) }),
]);
export type RegisterPushRequest = z.infer<typeof RegisterPushRequest>;

/** Messages the server sends on the realtime socket. */
export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), userId: z.string(), deviceId: z.string() }),
  z.object({ type: z.literal('sync.changed'), seq: z.string() }),
  z.object({ type: z.literal('notify.new'), notification: NotificationView }),
  z.object({ type: z.literal('notify.read'), id: z.string() }),
  z.object({ type: z.literal('notify.dismissed'), id: z.string() }),
  z.object({ type: z.literal('session.revoked') }),
  z.object({ type: z.literal('entitlements.changed'), entitlements: z.array(z.string()) }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
