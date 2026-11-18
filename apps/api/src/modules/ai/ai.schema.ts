import { boolean, doublePrecision, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from '../../db/columns';

/** Every model call (ADR-0010): what for, which model, how much. The daily cap is read from here. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id'),
    task: text('task').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    ok: boolean('ok').notNull().default(true),
    /** day (YYYY-MM-DD) in AI_BUDGET_TZ the cost counts against */
    day: text('day').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ai_usage_day_idx').on(t.day), index('ai_usage_owner_day_idx').on(t.ownerId, t.day)],
);
