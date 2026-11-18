import { z } from 'zod';

/** Library (spec 0004): documents and notes the AI can read — titled, tagged, searchable, with dates that remind you. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LIBRARY_DOC = 'library.doc';

export const LIBRARY_CATEGORIES = [
  'Identity',
  'Insurance',
  'Finance',
  'Tax',
  'Property',
  'Vehicle',
  'Health',
  'Education',
  'Work',
  'Travel',
  'Warranty',
  'Receipts',
  'Notes',
  'Other',
] as const;

export const LIBRARY_STATUSES = ['new', 'reading', 'ready', 'waiting', 'failed'] as const;

export const KeyDate = z.object({ label: z.string().min(1).max(80), date: isoDate });
export const KeyAmount = z.object({
  label: z.string().min(1).max(80),
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
});

export const LibraryDocFields = z.object({
  kind: z.enum(['file', 'note']).default('file'),
  title: z.string().trim().max(200).default(''),
  category: z.string().max(40).default('Other'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  summary: z.string().max(2000).default(''),
  /** a note's body, or the words read from a document (what search looks through) */
  text: z.string().max(100_000).default(''),
  fileId: z.string().uuid().nullable().default(null),
  fileName: z.string().max(200).default(''),
  mime: z.string().max(100).default(''),
  size: z.number().int().min(0).max(100_000_000).default(0),
  /** new → reading → ready; waiting = the day's AI limit was reached, it continues tomorrow */
  status: z.enum(LIBRARY_STATUSES).default('ready'),
  problem: z.string().max(300).nullable().default(null),
  keyDates: z.array(KeyDate).max(20).default([]),
  amounts: z.array(KeyAmount).max(10).default([]),
  /** the date it runs out; reminds 30, 7 and 1 days before and on the day */
  expiresOn: isoDate.nullable().default(null),
  remind: z.boolean().default(true),
  /** the AI saw an amount due: none · suggested (a tap adds it to Money) · added · dismissed */
  moneyState: z.enum(['none', 'suggested', 'added', 'dismissed']).default('none'),
  source: z.string().max(20).default('web'),
});
export type LibraryDocFields = z.infer<typeof LibraryDocFields>;
export type LibraryDoc = LibraryDocFields & { id: string };

/** What the AI returns for a document (spec 0004 AC1). Dates are read as written; nothing is invented. */
export const LibraryRead = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().max(40).default('Other'),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  summary: z.string().max(1500).default(''),
  keyDates: z.array(KeyDate).max(12).default([]),
  expiresOn: isoDate.nullable().default(null),
  /** in rupees (the currency's main unit) as printed */
  amounts: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        amount: z.number().positive().max(100_000_000),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default('INR'),
      }),
    )
    .max(8)
    .default([]),
  /** the main words of the document, for search (not the whole thing) */
  text: z.string().max(6000).default(''),
});
export type LibraryRead = z.infer<typeof LibraryRead>;
