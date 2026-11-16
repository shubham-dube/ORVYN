import { z } from 'zod';

export const MutationOp = z.enum(['upsert', 'delete']);

export const Mutation = z.object({
  /** Client-generated, globally unique: makes pushes idempotent. */
  mutationId: z.string().uuid(),
  entity: z.string().regex(/^[a-z][a-z0-9_.]{1,60}$/),
  entityId: z.string().uuid(),
  op: MutationOp,
  /** Changed fields only (upsert). Each field carries the mutation's HLC. */
  fields: z.record(z.string(), z.unknown()).default({}),
  hlc: z.string(),
});
export type Mutation = z.infer<typeof Mutation>;

export const PushRequest = z.object({ mutations: z.array(Mutation).min(1).max(500) });
export type PushRequest = z.infer<typeof PushRequest>;

export const PushResult = z.object({
  applied: z.array(z.object({ mutationId: z.string(), seq: z.string() })),
  rejected: z.array(z.object({ mutationId: z.string(), reason: z.string() })),
  /** Server HLC after merging, so clients can keep their clocks moving forward. */
  hlc: z.string(),
});
export type PushResult = z.infer<typeof PushResult>;

export const Change = z.object({
  seq: z.string(),
  entity: z.string(),
  entityId: z.string(),
  op: MutationOp,
  /** Full current row (upsert) — clients replace their copy; tombstone on delete. */
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type Change = z.infer<typeof Change>;

export const PullResponse = z.object({
  changes: z.array(Change),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof PullResponse>;
