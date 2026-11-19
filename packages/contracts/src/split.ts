import { z } from 'zod';

/** Split (spec 0011 part B, ADR-0015). Amounts in the API are rupees; stored and computed in paise. */

export const SPLIT_KINDS = ['trip', 'party', 'home', 'other'] as const;
export const SPLIT_METHODS = ['equal', 'exact', 'percent', 'shares'] as const;
export const SPLIT_CATEGORIES = ['food', 'stay', 'travel', 'drinks', 'tickets', 'shopping', 'other'] as const;

export const NewSplitGroup = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(SPLIT_KINDS).default('trip'),
  /** ORVYN people (by id) */
  memberIds: z.array(z.string().uuid()).max(49).default([]),
  /** people not on ORVYN */
  guests: z
    .array(z.object({ name: z.string().trim().min(1).max(40), phone: z.string().trim().max(20).default('') }))
    .max(49)
    .default([]),
  /** also make a group chat for it */
  withChat: z.boolean().default(false),
});
export type NewSplitGroup = z.infer<typeof NewSplitGroup>;

export const SplitMemberInput = z.object({
  userId: z.string().uuid().nullable().default(null),
  name: z.string().trim().max(40).default(''),
  phone: z.string().trim().max(20).default(''),
  upi: z.string().trim().max(80).default(''),
});
export type SplitMemberInput = z.infer<typeof SplitMemberInput>;

export const ExpenseInput = z.object({
  title: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(10_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(SPLIT_CATEGORIES).default('other'),
  note: z.string().max(500).default(''),
  receiptFileId: z.string().uuid().nullable().default(null),
  /** who paid: one person, or several contributions (₹) that add up to the amount */
  paid: z
    .array(z.object({ memberId: z.string().uuid(), amount: z.number().positive() }))
    .min(1)
    .max(50),
  split: z.object({
    method: z.enum(SPLIT_METHODS),
    /** equal: value ignored; exact: ₹; percent: %; shares: weights */
    among: z
      .array(z.object({ memberId: z.string().uuid(), value: z.number().min(0).default(0) }))
      .min(1)
      .max(50),
  }),
});
export type ExpenseInput = z.infer<typeof ExpenseInput>;

export const SettlementInput = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  method: z.string().trim().max(30).default('UPI'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(300).default(''),
});
export type SettlementInput = z.infer<typeof SettlementInput>;

export interface SplitMemberView {
  id: string;
  userId: string | null;
  name: string;
  phone: string;
  upi: string;
  guest: boolean;
  /** paise: + gets money, − owes */
  balance: number;
  paid: number;
  consumed: number;
}

export interface SplitExpenseView {
  id: string;
  title: string;
  amount: number;
  date: string;
  category: string;
  note: string;
  receiptFileId: string | null;
  addedBy: string;
  paid: { memberId: string; amount: number }[];
  shares: { memberId: string; amount: number }[];
  method: string;
  /** what the raw split said (for editing) */
  among: { memberId: string; value: number }[];
  createdAt: string;
}
