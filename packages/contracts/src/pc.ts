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

/** A terminal I was waiting for has ended (spec 0021 #13). What ran and what it printed stay out of it. */
export const PcDone = z.object({ id: z.string().uuid(), pc: z.string().min(1).max(60) }).strict();
export type PcDone = z.infer<typeof PcDone>;

/** Say it, run it (#12): only the wish goes to the server, and what comes back is only text. */
export const PcWant = z
  .object({
    want: z.string().trim().min(3).max(500),
    shell: z.enum(['PowerShell 7', 'PowerShell', 'Command Prompt', 'Git Bash']),
  })
  .strict();
export type PcWant = z.infer<typeof PcWant>;
export const PcSuggestion = z.object({
  /** one line, shown to be edited and run by hand; control characters could press Enter by themselves */
  command: z
    .string()
    .max(2000)
    // eslint-disable-next-line no-control-regex
    .transform((s) => s.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').trim()),
  why: z.string().max(300).default(''),
  careful: z.boolean().default(true),
});
export type PcSuggestion = z.infer<typeof PcSuggestion>;
