import { z } from 'zod';

/** The Brief (spec 0009): what each part says. Built by rules on the server; clients only show it. */
export const BRIEF_SECTIONS = [
  'agenda',
  'money',
  'drop',
  'library',
  'work',
  'mail',
  // spec 0016
  'weather',
  'focus',
  'ipo',
  'markets',
  'yesterday',
] as const;
export type BriefSectionKind = (typeof BRIEF_SECTIONS)[number];

export const NUDGE_KINDS = ['slipped', 'budget', 'payments', 'drop'] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const BriefPlace = z.object({
  name: z.string().trim().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type BriefPlace = z.infer<typeof BriefPlace>;

export const BriefSettings = z.object({
  enabled: z.boolean().default(false),
  at: hhmm.default('07:30'),
  /** for the weather (spec 0016 B1); nothing about the device's location is sent */
  place: BriefPlace.nullable().default(null),
  /** the opening written by the AI from the Brief's facts (D-0016-5) */
  ai: z.boolean().default(true),
  sections: z
    .array(z.enum(BRIEF_SECTIONS))
    .max(BRIEF_SECTIONS.length)
    .default([...BRIEF_SECTIONS]),
  nudges: z
    .object({
      enabled: z.boolean().default(true),
      kinds: z
        .array(z.enum(NUDGE_KINDS))
        .max(NUDGE_KINDS.length)
        .default([...NUDGE_KINDS]),
      max: z.number().int().min(0).max(5).default(2),
    })
    .default({}),
});
export type BriefSettings = z.infer<typeof BriefSettings>;

export interface BriefAgenda {
  kind: 'agenda';
  events: {
    title: string;
    at: string | null;
    until: string | null;
    allDay: boolean;
    location: string | null;
  }[];
  dueToday: number;
  overdue: number;
  /** the most important open tasks for today, highest priority first */
  top: { id: string; title: string; priority: number; overdue: boolean }[];
}
export interface BriefMoney {
  kind: 'money';
  yesterdayMinor: number;
  monthMinor: number;
  /** budgets at 80% or more this month */
  budgets: { name: string; spentMinor: number; amountMinor: number }[];
  toReview: number;
  /** spec 0016: what's truly mine now (spec 0014), when balances are set up */
  inHandMinor?: number | null;
  /** due in the next 3 days: repeating payments and debts (both ways) */
  dues?: { title: string; amountMinor: number; on: string; kind: 'pay' | 'collect' }[];
}
export interface BriefDrop {
  kind: 'drop';
  waiting: number;
}
export interface BriefLibrary {
  kind: 'library';
  expiring: { id: string; title: string; expiresOn: string; days: number }[];
}
export interface BriefWork {
  kind: 'work';
  issues: number;
  reviews: number;
  clickup: number;
  clickupDueToday: number;
  /** what I'm working on in ClickUp — the working statuses (Design, Development, In progress…), as Today shows them */
  tasks: {
    id: string;
    name: string;
    status: string;
    statusColor: string | null;
    list: string;
    due: string | null;
    overdue: boolean;
    url: string;
  }[];
  /** reviews asked of me, then issues assigned */
  github: { kind: 'review' | 'issue'; title: string; repo: string; number: number; url: string }[];
}
export interface BriefMail {
  kind: 'mail';
  unread: number;
  boxes: { account: string; unread: number }[];
}
export interface BriefWeather {
  kind: 'weather';
  place: string;
  now: number | null;
  feels: number | null;
  high: number | null;
  low: number | null;
  rain: number | null;
  code: number | null;
  /** "Clear", "Light rain"… */
  sky: string;
  sunrise: string | null;
  sunset: string | null;
  advice: string | null;
}
export interface BriefFocus {
  kind: 'focus';
  /** up to three tasks, each with a free slot it would fit in */
  items: {
    id: string;
    title: string;
    priority: number;
    overdue: boolean;
    due: string | null;
    minutes: number;
    slot: { start: string; end: string } | null;
    planned: boolean;
  }[];
  /** free time between meetings today (from now on) */
  free: { start: string; end: string }[];
}
export interface BriefIpo {
  kind: 'ipo';
  items: {
    id: string;
    name: string;
    logo: string | null;
    /** what's happening today */
    today: 'opens' | 'closes' | 'open' | 'allotment' | 'listing' | 'upcoming';
    gmp: number | null;
    gmpPct: number | null;
    lotAmount: number | null;
    gainPerLot: number | null;
    closeDate: string | null;
    decision: string | null;
  }[];
}
export interface BriefMarkets {
  kind: 'markets';
  items: { name: string; last: number; changePct: number }[];
  /** when the figures are from */
  at: string | null;
}
export interface BriefYesterday {
  kind: 'yesterday';
  done: number;
  spentMinor: number;
  /** days in a row with nothing left overdue at the end of the day */
  streak: number;
}
export type BriefSection =
  | BriefAgenda
  | BriefMoney
  | BriefDrop
  | BriefLibrary
  | BriefWork
  | BriefMail
  | BriefWeather
  | BriefFocus
  | BriefIpo
  | BriefMarkets
  | BriefYesterday;

/** Plan a focus task into a free slot (spec 0016 B1). */
export const BriefPlan = z.object({
  taskId: z.string().uuid(),
  start: z.string().datetime({ offset: true }),
  minutes: z.number().int().min(5).max(600),
});
export type BriefPlan = z.infer<typeof BriefPlan>;

export interface BriefView {
  day: string;
  generatedAt: string;
  /** "3 meetings, 5 tasks · first at 10:00" */
  headline: string;
  /** a shorter line for the notification body */
  line: string;
  /** "Good morning, Asha" */
  greeting?: string;
  /** the opening the AI wrote from these facts (spec 0016 B1); null without AI */
  story?: string | null;
  /** one suggestion from the AI, in a line */
  tip?: string | null;
  sections: BriefSection[];
}
