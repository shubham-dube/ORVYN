import { z } from 'zod';
import { ReminderWay } from './today';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().datetime({ offset: true });

/**
 * What the Assistant may propose (spec 0005, D25). Nothing here happens until the person confirms it; the server
 * checks every field and writes the card's wording itself, so what is confirmed is exactly what is shown.
 */
export const AssistantProposal = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(1).max(300),
    dueDate: isoDate.nullable().default(null),
    dueAt: isoDateTime.nullable().default(null),
    priority: z.number().int().min(0).max(3).default(0),
    /** how the reminder at the moment reaches the person (alarm, email…); none = their defaults */
    remindVia: z.array(ReminderWay).max(5).default([]),
  }),
  z.object({
    type: z.literal('move_task'),
    taskId: z.string().uuid(),
    dueDate: isoDate.nullable().default(null),
    dueAt: isoDateTime.nullable().default(null),
  }),
  z.object({ type: z.literal('complete_task'), taskId: z.string().uuid() }),
  z.object({
    type: z.literal('create_event'),
    title: z.string().trim().min(1).max(300),
    start: isoDateTime,
    end: isoDateTime,
    location: z.string().max(300).default(''),
  }),
  z.object({
    type: z.literal('add_expense'),
    /** rupees, as said */
    amount: z.number().positive().max(100_000_000),
    direction: z.enum(['debit', 'credit']).default('debit'),
    merchant: z.string().max(120).default(''),
    category: z.string().max(60).default(''),
    occurredAt: isoDateTime.nullable().default(null),
    note: z.string().max(500).default(''),
  }),
  z.object({
    type: z.literal('save_note'),
    title: z.string().trim().min(1).max(200),
    text: z.string().max(10_000).default(''),
  }),
]);
export type AssistantProposal = z.infer<typeof AssistantProposal>;

export const ProposalStatus = z.enum(['open', 'done', 'dismissed', 'failed']);

export const AssistantProposalView = z.object({
  index: z.number().int(),
  proposal: AssistantProposal,
  /** the server's own words for it */
  summary: z.string(),
  status: ProposalStatus,
  problem: z.string().nullable(),
});
export type AssistantProposalView = z.infer<typeof AssistantProposalView>;

export const AssistantMessageView = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  proposals: z.array(AssistantProposalView),
  sources: z.array(z.string()),
  /** the day's AI limit stopped this answer */
  paused: z.boolean().default(false),
  createdAt: z.string(),
});
export type AssistantMessageView = z.infer<typeof AssistantMessageView>;

export const AssistantThreadView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  updatedAt: z.string(),
});
export type AssistantThreadView = z.infer<typeof AssistantThreadView>;

export const AskRequest = z.object({
  threadId: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(2000),
});
