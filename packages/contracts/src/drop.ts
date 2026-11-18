import { z } from 'zod';

/** Drop (spec 0003): one place to throw anything; the AI proposes what it is, the person confirms. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().datetime({ offset: true });

export const DROP_ITEM = 'drop.item';

export const DropProposal = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task'),
    title: z.string().min(1).max(500),
    dueDate: isoDate.nullable().default(null),
    dueAt: isoDateTime.nullable().default(null),
    durationMin: z.number().int().min(5).max(1440).nullable().default(null),
    priority: z.number().int().min(0).max(3).default(0),
    notes: z.string().max(4000).default(''),
    why: z.string().max(200).default(''),
  }),
  z.object({
    kind: z.literal('event'),
    title: z.string().min(1).max(500),
    start: isoDateTime,
    end: isoDateTime,
    location: z.string().max(300).default(''),
    notes: z.string().max(4000).default(''),
    why: z.string().max(200).default(''),
  }),
  z.object({
    kind: z.literal('expense'),
    /** in rupees (or the currency's main unit) as read */
    amount: z.number().positive().max(100_000_000),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    direction: z.enum(['debit', 'credit']).default('debit'),
    merchant: z.string().max(120).default(''),
    /** one of the person's category names, or a new one */
    category: z.string().max(40).default('Other'),
    occurredAt: isoDateTime.nullable().default(null),
    note: z.string().max(2000).default(''),
    why: z.string().max(200).default(''),
  }),
  z.object({
    kind: z.literal('note'),
    title: z.string().min(1).max(200),
    text: z.string().max(20_000).default(''),
    why: z.string().max(200).default(''),
  }),
]);
export type DropProposal = z.infer<typeof DropProposal>;

export const DROP_STATUSES = [
  'new',
  'thinking',
  'proposed',
  'waiting',
  'failed',
  'done',
  'kept',
  'dismissed',
] as const;

export const DropItemFields = z.object({
  kind: z.enum(['text', 'voice', 'photo', 'file', 'link']).default('text'),
  /** what was typed, the voice transcript (made on the device), or a caption */
  text: z.string().max(20_000).default(''),
  fileId: z.string().uuid().nullable().default(null),
  fileName: z.string().max(200).nullable().default(null),
  url: z.string().url().max(2000).nullable().default(null),
  source: z.enum(['orb', 'share', 'web', 'extension', 'desktop', 'widget']).default('web'),
  status: z.enum(DROP_STATUSES).default('new'),
  /** written only by the server */
  proposal: DropProposal.nullable().default(null),
  /** why it's waiting or failed, in plain words (server) */
  problem: z.string().max(300).nullable().default(null),
  /** what confirming created, e.g. "today.task:<id>" */
  resultRef: z.string().max(80).nullable().default(null),
  /** what the person changed before confirming: used as an example next time */
  correction: DropProposal.nullable().default(null),
});
export type DropItemFields = z.infer<typeof DropItemFields>;
export type DropItem = DropItemFields & { id: string };
