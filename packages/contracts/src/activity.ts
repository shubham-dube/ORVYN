import { z } from 'zod';

/** The activity record (spec 0020, ADR-0018). Counts only: never which keys. */
export const ACTIVITY_CATEGORIES = [
  'code',
  'work',
  'meeting',
  'messages',
  'mail',
  'learning',
  'research',
  'ai',
  'jobs',
  'money',
  'shopping',
  'social',
  'video',
  'music',
  'games',
  'system',
  'other',
] as const;
export const ActivityCategory = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategory = z.infer<typeof ActivityCategory>;

const count = z.number().int().min(0).max(1_000_000).default(0);

export const ActivitySpan = z
  .object({
    id: z.string().uuid(),
    source: z.enum(['web', 'pc', 'phone']),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    /** active = in front and used; media = watching or listening; away / locked = nobody there */
    kind: z.enum(['active', 'media', 'away', 'locked']).default('active'),
    /** the program ("chrome.exe", "Code.exe"); for the browser, its name; on a phone, the app's package */
    app: z.string().max(120).default(''),
    host: z.string().max(253).default(''),
    /** path only: query strings are never sent, except `q` of a search */
    path: z.string().max(500).default(''),
    title: z.string().max(300).default(''),
    q: z.string().max(200).default(''),
    keys: count,
    clicks: count,
    scrolls: count,
  })
  .refine((s) => Date.parse(s.end) >= Date.parse(s.start), 'end before start')
  .refine((s) => Date.parse(s.end) - Date.parse(s.start) <= 24 * 3_600_000, 'longer than a day');
export type ActivitySpan = z.infer<typeof ActivitySpan>;

export const ActivityPush = z.object({ spans: z.array(ActivitySpan).min(1).max(300) });
export type ActivityPush = z.infer<typeof ActivityPush>;

/** "github.com" or "Code.exe" → what it counts as; and which sites the focus shield stops */
export const ActivityRules = z.object({
  categories: z.record(z.string().min(1).max(253), ActivityCategory).default({}),
  blocked: z.array(z.string().min(1).max(253)).max(200).default([]),
});
export type ActivityRules = z.infer<typeof ActivityRules>;

export interface DayBlock {
  start: string;
  end: string;
  kind: 'active' | 'media' | 'away' | 'locked';
  place: string;
  what: string;
  /** the host or program, for filing it elsewhere */
  key: string;
  category: ActivityCategory;
  keys: number;
  clicks: number;
  scrolls: number;
  /** which device (its name) */
  device: string;
}

/** One device's own day, beside the others (spec 0024). */
export interface DayDevice {
  id: string;
  name: string;
  /** pc, web, phone; a browser on a PC goes with that PC */
  kind: 'pc' | 'web' | 'phone';
  /** browsers that were found to run on this PC */
  with: string[];
  activeMs: number;
  blocks: DayBlock[];
  places: DayPlace[];
}
export interface DayPlace {
  place: string;
  key: string;
  category: ActivityCategory;
  ms: number;
  visits: number;
  whats: { what: string; ms: number }[];
}
export interface ActivityDay {
  date: string;
  firstAt: string | null;
  lastAt: string | null;
  /** time with any device in use, counted once however many were */
  activeMs: number;
  awayMs: number;
  /** each device on its own; `blocks` is where the attention was, moment by moment */
  devices: DayDevice[];
  byCategory: { category: ActivityCategory; ms: number }[];
  places: DayPlace[];
  blocks: DayBlock[];
  /** runs of 25 minutes or more of working time */
  deep: { start: string; end: string; category: ActivityCategory; ms: number; whats: string[] }[];
  deepMs: number;
  switches: number;
  /** active ms per hour of the day (local) */
  hours: number[];
  keys: number;
  clicks: number;
  scrolls: number;
}
export interface ActivityDaySummary {
  date: string;
  activeMs: number;
  deepMs: number;
  firstAt: string | null;
  lastAt: string | null;
  byCategory: { category: ActivityCategory; ms: number }[];
}
export const ActivityStory = z.object({
  story: z.string().max(3000),
  wins: z.array(z.string().max(300)).max(5).default([]),
  leaks: z.array(z.string().max(300)).max(5).default([]),
  tomorrow: z.string().max(500).default(''),
});
export type ActivityStory = z.infer<typeof ActivityStory>;
