import { z } from 'zod';

export const NotificationAction = z.object({
  id: z.string().regex(/^[a-z0-9_.-]{1,40}$/),
  label: z.string().max(30),
  /** Opens the app at this path instead of running in the background. */
  open: z.string().max(300).optional(),
  /** Asks for a short typed answer (Android inline reply, a text box in the app); sent with the action. */
  reply: z.object({ placeholder: z.string().max(80) }).optional(),
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
  /** rings like an alarm on devices that can (D22) */
  alarm: z.boolean().default(false),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});
export type NotificationView = z.infer<typeof NotificationView>;

/** Where a person can be reached besides the apps (D23). The number is only ever shown masked. */
export const ContactChannels = z.object({
  email: z.string(),
  whatsapp: z.object({
    /** server has the Meta credentials */
    available: z.boolean(),
    /** e.g. +91 ••••• ••123, null when none */
    masked: z.string().nullable(),
    verified: z.boolean(),
  }),
});
export type ContactChannels = z.infer<typeof ContactChannels>;

// ------------------------------------------------------------------ the catalog (spec 0019)

/** The ways a notification can reach me besides the in-app inbox (D22, D-0019-1). */
export const NOTIFY_WAYS = ['push', 'urgent', 'alarm', 'email', 'whatsapp'] as const;
export type NotifyWay = (typeof NOTIFY_WAYS)[number];

export interface NotifyTypeInfo {
  key: string;
  module: string;
  label: string;
  /** when it fires, in plain words */
  when: string;
  /** the ways out of the box; [] = in-app only */
  ways: NotifyWay[];
  /** can't be turned off (security) */
  locked?: boolean;
  /** an alarm makes sense here (reminders, deadlines) */
  alarm?: boolean;
  /** set on each item instead (a task's reminders, a document's expiry): shown, linked, not set here */
  managedIn?: { label: string; href: string };
}

/** Every notification ORVYN sends, by module (D-0019-3). A test fails if code sends a type that isn't here. */
export const NOTIFY_CATALOG: NotifyTypeInfo[] = [
  {
    key: 'security.new_device',
    module: 'core',
    label: 'New sign-in',
    when: 'A device signs in to your account',
    ways: ['push', 'email'],
    locked: true,
  },
  {
    key: 'today.task_reminder',
    module: 'today',
    label: 'Task reminders',
    when: 'At each reminder time of a task',
    ways: ['push'],
    alarm: true,
    managedIn: { label: 'Today → Reminders, or on each task', href: '/settings#reminders' },
  },
  {
    key: 'today.event_reminder',
    module: 'today',
    label: 'Event reminders',
    when: 'Before each event, as set',
    ways: ['push'],
    alarm: true,
    managedIn: { label: 'Today → Reminders, or on each event', href: '/settings#reminders' },
  },
  {
    key: 'today.digest',
    module: 'today',
    label: 'The day’s list',
    when: 'Your dated tasks, at the digest time',
    ways: ['push'],
  },
  {
    key: 'today.calendar',
    module: 'today',
    label: 'Calendar needs reconnecting',
    when: 'Google stopped accepting the calendar link',
    ways: ['push', 'email'],
  },
  {
    key: 'today.tools',
    module: 'today',
    label: 'From your tools',
    when: 'GitHub reviews and issues for you; ClickUp tasks due or assigned',
    ways: ['push'],
  },
  {
    key: 'brief.ready',
    module: 'brief',
    label: 'Your Brief is ready',
    when: 'The morning Brief, at its time',
    ways: ['push'],
  },
  {
    key: 'brief.slipped',
    module: 'brief',
    label: 'Things slipped',
    when: '3 or more overdue tasks, once a day',
    ways: ['push'],
  },
  {
    key: 'brief.budget',
    module: 'brief',
    label: 'Budget nudge',
    when: 'A budget at 80% with a third of the month left, or used up',
    ways: ['push'],
  },
  {
    key: 'brief.payments',
    module: 'brief',
    label: 'Payments to look at',
    when: '5 or more payments waiting for a look',
    ways: ['push'],
  },
  {
    key: 'brief.drop',
    module: 'brief',
    label: 'Drop is filling up',
    when: '3 or more things waiting in Drop',
    ways: ['push'],
  },
  {
    key: 'inbox.important',
    module: 'inbox',
    label: 'Important mail',
    when: 'New mail that needs you: a reply, a bill, a security alert',
    ways: ['push'],
  },
  {
    key: 'money.review',
    module: 'money',
    label: 'A payment to file',
    when: 'A payment read from your phone that ORVYN can’t file alone; money in waits for a yes',
    ways: ['push'],
  },
  {
    key: 'money.filed',
    module: 'money',
    label: 'Filed for you',
    when: 'ORVYN filed a payment by your rule (a quiet note with Change)',
    ways: [],
  },
  {
    key: 'money.recurring',
    module: 'money',
    label: 'Bill or subscription due',
    when: 'A recurring payment is due',
    ways: ['push'],
    alarm: true,
  },
  {
    key: 'library.expiry',
    module: 'library',
    label: 'Document expiring',
    when: 'A passport, insurance or licence nearing its date',
    ways: ['push'],
    managedIn: { label: 'Library → each document', href: '/library' },
  },
  {
    key: 'chat.message',
    module: 'chat',
    label: 'New message',
    when: 'A message in a chat you haven’t muted',
    ways: ['push'],
  },
  {
    key: 'split.added',
    module: 'split',
    label: 'Added to a group',
    when: 'Someone adds you to a group',
    ways: ['push'],
  },
  {
    key: 'split.expense',
    module: 'split',
    label: 'New expense',
    when: 'Someone adds an expense you’re in',
    ways: ['push'],
  },
  {
    key: 'split.settlement',
    module: 'split',
    label: 'Payment recorded',
    when: 'Someone settles up with you',
    ways: ['push'],
  },
  {
    key: 'split.reminder',
    module: 'split',
    label: 'You owe',
    when: 'Someone reminds you what you owe',
    ways: ['push'],
  },
  {
    key: 'ipo.alert',
    module: 'ipo',
    label: 'IPO alerts',
    when: 'Opening, closing, GMP moves, allotment and listing — as the desk’s filters say',
    ways: ['push'],
  },
  {
    key: 'ipo.partner',
    module: 'ipo',
    label: 'A partner reported',
    when: 'A partner taps “I applied”, “mandate”, “allotted” or “sold” on their link',
    ways: ['push'],
  },
  {
    key: 'ipo.last_day',
    module: 'ipo',
    label: 'Last day: not applied yet',
    when: '10 am on the close day, if accounts haven’t applied or mandates are pending',
    ways: ['push'],
    alarm: true,
  },
  {
    key: 'ipo.closed',
    module: 'ipo',
    label: 'Bids closed',
    when: 'The round’s summary at 5 pm on the close day',
    ways: ['push'],
  },
];
export const NOTIFY_TYPE = new Map(NOTIFY_CATALOG.map((t) => [t.key, t]));
export const NOTIFY_MODULES: Record<string, string> = {
  core: 'Security',
  today: 'Today',
  brief: 'Brief',
  inbox: 'Mail',
  money: 'Money',
  library: 'Library',
  chat: 'Chat',
  split: 'Split',
  ipo: 'IPO',
};

export const NotifyRule = z.object({
  on: z.boolean().default(true),
  ways: z.array(z.enum(NOTIFY_WAYS)).max(5).default([]),
});
export type NotifyRule = z.infer<typeof NotifyRule>;

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
  /** per type: on/off and the ways (spec 0019); a type without a rule uses its default */
  rules: z
    .record(z.string().max(60), NotifyRule)
    .default({})
    .refine((r) => Object.keys(r).length <= 100, 'Too many rules'),
});
export type NotifySettings = z.infer<typeof NotifySettings>;

export const WebPushSubscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export const RegisterPushRequest = z.union([
  z.object({ channel: z.literal('webpush'), subscription: WebPushSubscription }),
  /**
   * An Android phone: its Firebase Installation ID (`fid`, Firebase's current method) or, from older app versions, a
   * registration token (`token`, deprecated by Firebase). Exactly one of them.
   */
  z
    .object({
      channel: z.literal('fcm'),
      fid: z.string().min(10).max(512).optional(),
      token: z.string().min(20).max(4096).optional(),
    })
    .refine((v) => !!v.fid !== !!v.token, { message: 'send either fid or token' }),
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
  z.object({
    type: z.literal('chat.message'),
    conversationId: z.string(),
    messageId: z.string(),
    /** the message itself (spec 0015), so a client adds or updates it without asking again */
    message: z.any().optional(),
  }),
  z.object({
    type: z.literal('chat.delivered'),
    conversationId: z.string(),
    userId: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('chat.presence'),
    userId: z.string(),
    online: z.boolean(),
    lastSeenAt: z.string().nullable(),
  }),
  z.object({ type: z.literal('chat.hidden'), conversationId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal('chat.changed'), conversationId: z.string() }),
  z.object({ type: z.literal('chat.typing'), conversationId: z.string(), userId: z.string() }),
  z.object({ type: z.literal('chat.read'), conversationId: z.string(), userId: z.string(), at: z.string() }),
  z.object({ type: z.literal('split.changed'), groupId: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
