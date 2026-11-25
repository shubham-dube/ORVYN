import { z } from 'zod';

/**
 * The PC from elsewhere (spec 0021 step 3, ADR-0019). The server only passes these on between two devices of the same
 * person: `d` is encrypted with a key it never has, and nothing is stored.
 */
export const PC_FRAME_MAX = 64 * 1024;
/** Without `to` it goes to all my other devices: only a short "is my PC there?" may do that. */
export const PC_FIND_MAX = 128;

export const PcFrame = z
  .object({
    type: z.literal('pc'),
    to: z.string().uuid().optional(),
    /** which session, chosen by the phone or browser */
    s: z.string().regex(/^[\w-]{16,64}$/),
    d: z.string().min(1).max(PC_FRAME_MAX),
  })
  .strict()
  .refine((f) => f.to !== undefined || f.d.length <= PC_FIND_MAX, 'to is needed');
export type PcFrame = z.infer<typeof PcFrame>;
