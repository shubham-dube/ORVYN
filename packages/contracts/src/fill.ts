import { z } from 'zod';

/** Magic fill (spec 0020). A profile is facts by key; labels of a form are matched to keys, values stay put. */
export const FILL_GROUPS = [
  'identity',
  'contact',
  'address',
  'work',
  'education',
  'links',
  'money',
  'other',
] as const;
export const FillFact = z.object({
  key: z.string().regex(/^[a-z0-9_.]{1,60}$/),
  label: z.string().max(120),
  value: z.string().max(5000),
  group: z.enum(FILL_GROUPS).default('other'),
});
export type FillFact = z.infer<typeof FillFact>;

/** Something answered before: a question in words, and the answer. */
export const FillAnswer = z.object({
  q: z.string().min(1).max(500),
  a: z.string().max(5000),
  host: z.string().max(253).default(''),
});
export type FillAnswer = z.infer<typeof FillAnswer>;

export const FillProfile = z.object({
  facts: z.array(FillFact).max(400).default([]),
  answers: z.array(FillAnswer).max(1000).default([]),
  /** the whole story in words (experience, projects): used only when a draft is asked for */
  story: z.string().max(60_000).default(''),
});
export type FillProfile = z.infer<typeof FillProfile>;

export const FillField = z.object({
  id: z.string().max(40),
  label: z.string().max(300).default(''),
  type: z.string().max(30).default('text'),
  name: z.string().max(120).default(''),
  autocomplete: z.string().max(60).default(''),
  options: z.array(z.string().max(120)).max(80).default([]),
});
export type FillField = z.infer<typeof FillField>;

/** Labels and the NAMES of facts only. There is no place for a value here, by design. */
export const FillMapRequest = z
  .object({
    fields: z.array(FillField.strict()).min(1).max(120),
    keys: z.array(z.object({ key: z.string().max(60), label: z.string().max(120) }).strict()).max(400),
  })
  .strict();
export type FillMapRequest = z.infer<typeof FillMapRequest>;

export const FillMapReply = z.object({
  map: z.array(z.object({ id: z.string().max(40), key: z.string().max(60).nullable() })).max(200),
});
export type FillMapReply = z.infer<typeof FillMapReply>;

export const FillStructureRequest = z.object({ text: z.string().min(20).max(60_000) });
export const FillDraftRequest = z.object({
  question: z.string().min(3).max(600),
  page: z.string().max(6000).default(''),
  maxChars: z.number().int().min(20).max(5000).default(900),
});

export const PAGE_MODES = ['brief', 'ask', 'catch', 'actions', 'compare'] as const;
export type PageMode = (typeof PAGE_MODES)[number];
export const PageReadRequest = z.object({
  mode: z.enum(PAGE_MODES),
  question: z.string().max(600).default(''),
  pages: z
    .array(
      z.object({
        url: z.string().max(2000),
        title: z.string().max(300).default(''),
        text: z.string().max(24_000),
      }),
    )
    .min(1)
    .max(6),
});
export type PageReadRequest = z.infer<typeof PageReadRequest>;

export const PageReadReply = z.object({
  text: z.string().max(6000).default(''),
  points: z.array(z.string().max(400)).max(12).default([]),
  /** lines ORVYN's own quick add understands; nothing is added until the person presses it */
  actions: z
    .array(z.object({ kind: z.enum(['task', 'expense']), text: z.string().min(1).max(300) }))
    .max(8)
    .default([]),
});
export type PageReadReply = z.infer<typeof PageReadReply>;
