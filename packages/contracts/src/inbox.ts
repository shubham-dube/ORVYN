import { z } from 'zod';

/** The smart inbox (spec 0017 B): every mailbox, triaged into what matters. */

export const INBOX_CATEGORIES = [
  'needs_reply',
  'action',
  'bill',
  'money',
  'security',
  'travel',
  'delivery',
  'event',
  'work',
  'update',
  'newsletter',
  'promotion',
  'social',
] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export const INBOX_ACTIONS = ['reply', 'pay', 'task', 'track', 'calendar', 'none'] as const;
export type InboxAction = (typeof INBOX_ACTIONS)[number];

/** Where a category goes in the lists (spec 0017 B3). */
export const INBOX_GROUP: Record<InboxCategory, 'important' | 'updates' | 'rest'> = {
  needs_reply: 'important',
  action: 'important',
  bill: 'important',
  money: 'important',
  security: 'important',
  travel: 'updates',
  delivery: 'updates',
  event: 'updates',
  work: 'updates',
  update: 'updates',
  newsletter: 'rest',
  promotion: 'rest',
  social: 'rest',
};

export interface InboxItemView {
  id: string;
  account: string;
  provider: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  at: string | null;
  url: string | null;
  category: InboxCategory;
  /** 0–100 */
  score: number;
  /** what's in it for me, in a line */
  summary: string;
  why: string;
  action: InboxAction;
  amountMinor: number | null;
  dueDate: string | null;
  pinned: boolean;
  /** the sender as I taught it */
  sender: 'vip' | 'mute' | null;
  by: 'ai' | 'rules';
}

export interface InboxView {
  /** a short AI paragraph over what's important (null without AI) */
  catchUp: string | null;
  important: InboxItemView[];
  updates: InboxItemView[];
  rest: InboxItemView[];
  boxes: {
    connectionId: string;
    account: string;
    provider: string;
    unread: number;
    /** of those, how many matter (spec 0018: the count that's worth a badge) */
    important?: number;
    problem?: string;
  }[];
  refreshedAt: string | null;
}

/** For badges (spec 0018, D-0018-6): the mail that matters, not every unread. */
export interface InboxCounts {
  important: number;
  unread: number;
  boxes: { account: string; unread: number; important: number }[];
}

export const InboxActBody = z.object({ action: z.enum(['done', 'pin', 'unpin', 'remind']) });
export const InboxSenderBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  rule: z.enum(['vip', 'mute']).nullable(),
});
export const InboxSettings = z.object({
  /** important new mail pings (D-0017-4) */
  notify: z.boolean().default(true),
  maxPerDay: z.number().int().min(1).max(20).default(5),
});
export type InboxSettings = z.infer<typeof InboxSettings>;

// ------------------------------------------------------------------ Home (spec 0017 A)

/** One thing waiting on me, from any module, with one tap to act. */
export interface AttentionItem {
  id: string;
  kind: 'mail' | 'ipo' | 'review' | 'due' | 'payments' | 'overdue' | 'expiring' | 'drop';
  title: string;
  line: string;
  /** 0 now/today, 1 soon, 2 when you can */
  urgency: 0 | 1 | 2;
  href: string;
  /** an outside link (mail, PR) */
  url?: string | null;
  /** what the tap does in place */
  act?: { label: string; kind: 'apply' | 'done' | 'task' | 'open' };
}

export interface HomeView {
  needsYou: AttentionItem[];
  more: number;
  brief: {
    greeting: string | null;
    line: string | null;
    weather: {
      now: number | null;
      sky: string;
      code: number | null;
      high: number | null;
      low: number | null;
      place: string;
    } | null;
  } | null;
  inbox: { important: number; top: InboxItemView[]; catchUp: string | null } | null;
  ipos: {
    id: string;
    name: string;
    logo: string | null;
    closeDate: string | null;
    gmpPct: number | null;
    decision: string | null;
    status: string;
  }[];
  markets: { name: string; last: number; changePct: number }[];
}
