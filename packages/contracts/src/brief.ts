import { z } from 'zod';

/** The Brief (spec 0009): what each part says. Built by rules on the server; clients only show it. */
export const BRIEF_SECTIONS = ['agenda', 'money', 'drop', 'library', 'work', 'mail'] as const;
export type BriefSectionKind = (typeof BRIEF_SECTIONS)[number];

export const NUDGE_KINDS = ['slipped', 'budget', 'payments', 'drop'] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const BriefSettings = z.object({
  enabled: z.boolean().default(false),
  at: hhmm.default('07:30'),
  sections: z.array(z.enum(BRIEF_SECTIONS)).max(BRIEF_SECTIONS.length).default([...BRIEF_SECTIONS]),
  nudges: z
    .object({
      enabled: z.boolean().default(true),
      kinds: z.array(z.enum(NUDGE_KINDS)).max(NUDGE_KINDS.length).default([...NUDGE_KINDS]),
      max: z.number().int().min(0).max(5).default(2),
    })
    .default({}),
});
export type BriefSettings = z.infer<typeof BriefSettings>;

export interface BriefAgenda {
  kind: 'agenda';
  events: { title: string; at: string | null; until: string | null; allDay: boolean; location: string | null }[];
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
}
export interface BriefMail {
  kind: 'mail';
  unread: number;
  boxes: { account: string; unread: number }[];
}
export type BriefSection = BriefAgenda | BriefMoney | BriefDrop | BriefLibrary | BriefWork | BriefMail;

export interface BriefView {
  day: string;
  generatedAt: string;
  /** "3 meetings, 5 tasks · first at 10:00" */
  headline: string;
  /** a shorter line for the notification body */
  line: string;
  sections: BriefSection[];
}
