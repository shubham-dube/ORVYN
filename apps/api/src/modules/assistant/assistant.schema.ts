import { boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';

/** Conversations with the Assistant (spec 0005). Server-side only; every query is the person's own. */
export const assistantThreads = pgTable(
  'assistant_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assistant_threads_owner_idx').on(t.ownerId, t.updatedAt)],
);

export interface StoredProposal {
  proposal: Record<string, unknown>;
  summary: string;
  status: 'open' | 'done' | 'dismissed' | 'failed';
  problem: string | null;
  /** what confirming made ("today.task:<id>") */
  resultRef?: string;
}

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    text: text('text').notNull(),
    proposals: jsonb('proposals').$type<StoredProposal[]>().notNull().default([]),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    paused: boolean('paused').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assistant_messages_thread_idx').on(t.threadId, t.createdAt)],
);
