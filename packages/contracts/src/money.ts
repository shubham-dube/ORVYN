import { z } from 'zod';
import { PROJECT_COLOURS } from './today';

/** Money (spec 0003). Amounts are integers in minor units (paise); each transaction keeps its own currency. */
const isoDateTime = z.string().datetime({ offset: true });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

export const MONEY_ACCOUNT = 'money.account';
export const MONEY_CATEGORY = 'money.category';
export const MONEY_TRANSACTION = 'money.transaction';
export const MONEY_BUDGET = 'money.budget';
export const MONEY_RECURRING = 'money.recurring';
export const MONEY_IOU = 'money.iou';

/** One line typed somewhere small ("spent 240 lunch"). Nothing is saved by reading it. */
export const SpendRequest = z
  .object({ text: z.string().min(1).max(500), at: z.string().datetime({ offset: true }).optional() })
  .strict();
export type SpendRequest = z.infer<typeof SpendRequest>;

export const AccountFields = z.object({
  name: z.string().trim().min(1).max(80),
  /** card and loan accounts hold what you owe; the others hold what you have */
  kind: z.enum(['bank', 'card', 'upi', 'wallet', 'cash', 'loan']).default('bank'),
  /** last digits as the bank prints them (XX1234 → "1234") — never a full number */
  last4: z
    .string()
    .regex(/^\d{3,6}$/)
    .nullable()
    .default(null),
  institution: z.string().max(40).nullable().default(null),
  currency: currency.default('INR'),
  archived: z.boolean().default(false),
  /**
   * The balance as you last checked it (spec 0014): money in it for bank/cash/wallet/UPI, what you owe on it for a
   * card or a loan. Payments on the account after `balanceAt` move it from there. Null = not told yet.
   */
  balanceMinor: z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00).nullable().default(null),
  balanceAt: isoDateTime.nullable().default(null),
  /** a card's credit limit, for what's still available */
  creditLimitMinor: z.number().int().min(0).max(1_000_000_000_00).nullable().default(null),
});
export type AccountFields = z.infer<typeof AccountFields>;
export type Account = AccountFields & { id: string };

export const CategoryFields = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['expense', 'income', 'transfer']).default('expense'),
  /** a lucide icon name */
  icon: z.string().max(40).default('circle'),
  colour: z.enum(PROJECT_COLOURS).default('sky'),
  order: z.number().int().min(0).max(1000).default(0),
  archived: z.boolean().default(false),
  /** set on the starting categories, so readers can file "food" even after the person renames it */
  slug: z.string().max(40).nullable().default(null),
});
export type CategoryFields = z.infer<typeof CategoryFields>;
export type Category = CategoryFields & { id: string };

export const TX_SOURCES = [
  'sms',
  'notification',
  'manual',
  'drop',
  'receipt',
  'statement',
  'voice',
  'recurring',
] as const;

export const TransactionFields = z.object({
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  currency: currency.default('INR'),
  direction: z.enum(['debit', 'credit']).default('debit'),
  occurredAt: isoDateTime,
  /** cleaned name ("Swiggy") and what the message said ("UPI-RAZ*SWIGGY") */
  merchant: z.string().trim().max(120).default(''),
  rawMerchant: z.string().max(160).default(''),
  categoryId: z.string().uuid().nullable().default(null),
  accountId: z.string().uuid().nullable().default(null),
  note: z.string().max(2000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source: z.enum(TX_SOURCES).default('manual'),
  /** the same payment seen twice (bank SMS + UPI app, re-import) has the same key; unique per person */
  dedupeKey: z.string().max(120).nullable().default(null),
  /** UPI / RRN / reference number when the message has one */
  refNo: z.string().max(40).nullable().default(null),
  /** money moved between the person's own accounts: not spending */
  transfer: z.boolean().default(false),
  /** false = captured automatically and not looked at yet (the "new" strip, D20) */
  reviewed: z.boolean().default(true),
  receiptFileId: z.string().uuid().nullable().default(null),
  dropItemId: z.string().uuid().nullable().default(null),
  /** what it was, in your words ("Dinner with Riya") — shown first; the merchant is who was paid (spec 0014) */
  title: z.string().trim().max(120).default(''),
  /**
   * Counted as spending or income. False for money that only moves: lending, being paid back, paying for someone,
   * a credit you haven't confirmed yet (captured credits wait for a yes). Balances still move.
   */
  counted: z.boolean().default(true),
  /** a transfer between your own accounts: where it went (paying a card's bill from the bank) */
  toAccountId: z.string().uuid().nullable().default(null),
  /** the debt this payment lends, borrows or settles */
  iouId: z.string().uuid().nullable().default(null),
});
export type TransactionFields = z.infer<typeof TransactionFields>;
export type Transaction = TransactionFields & { id: string };

export const BudgetFields = z.object({
  /** null = everything */
  categoryId: z.string().uuid().nullable().default(null),
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  /** applies from this month on */
  from: month,
  archived: z.boolean().default(false),
});
export type BudgetFields = z.infer<typeof BudgetFields>;
export type Budget = BudgetFields & { id: string };

/**
 * Money that comes on a schedule (rent, subscriptions, salary, an SIP). Each day it's due the server adds it ('add': it
 * shows in the "new" strip like captured payments) or only reminds ('remind': you enter the real amount when it happens).
 */
export const RecurringFields = z.object({
  title: z.string().trim().min(1).max(80),
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  currency: currency.default('INR'),
  direction: z.enum(['debit', 'credit']).default('debit'),
  merchant: z.string().trim().max(120).default(''),
  categoryId: z.string().uuid().nullable().default(null),
  accountId: z.string().uuid().nullable().default(null),
  note: z.string().max(2000).default(''),
  /** RFC 5545 RRULE body, e.g. FREQ=MONTHLY;BYMONTHDAY=1 */
  rrule: z.string().min(5).max(300),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('09:00'),
  timeZone: z.string().min(1).max(64).default('Asia/Kolkata'),
  mode: z.enum(['add', 'remind']).default('add'),
  paused: z.boolean().default(false),
  /** written by the server: the last day handled, so nothing is added twice */
  lastRunOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type RecurringFields = z.infer<typeof RecurringFields>;
export type Recurring = RecurringFields & { id: string };

/**
 * Who owes whom (spec 0014): money you lent or paid for someone ("owed_to_me"), or borrowed / are holding for
 * someone ("i_owe"). Payments with `iouId` settle it; a due day can add a task to Today.
 */
export const IouFields = z.object({
  person: z.string().trim().min(1).max(80),
  direction: z.enum(['owed_to_me', 'i_owe']),
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  /** paid back so far */
  paidMinor: z.number().int().min(0).max(1_000_000_000_00).default(0),
  currency: currency.default('INR'),
  note: z.string().max(2000).default(''),
  /** YYYY-MM-DD it's due, if agreed */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /** counted in "what's in my hand" as money that will definitely come */
  sure: z.boolean().default(true),
  settledAt: isoDateTime.nullable().default(null),
  /** the reminder task in Today */
  taskId: z.string().uuid().nullable().default(null),
  /** when it started */
  startedAt: isoDateTime,
});
export type IouFields = z.infer<typeof IouFields>;
export type Iou = IouFields & { id: string };

/** Starting categories, created once per person (they can rename, recolour, hide or add). */
export const DEFAULT_CATEGORIES: {
  slug: string;
  name: string;
  kind: CategoryFields['kind'];
  icon: string;
  colour: (typeof PROJECT_COLOURS)[number];
}[] = [
  { slug: 'food', name: 'Food & dining', kind: 'expense', icon: 'utensils', colour: 'amber' },
  { slug: 'groceries', name: 'Groceries', kind: 'expense', icon: 'shopping-basket', colour: 'emerald' },
  { slug: 'transport', name: 'Transport', kind: 'expense', icon: 'car', colour: 'sky' },
  { slug: 'fuel', name: 'Fuel', kind: 'expense', icon: 'fuel', colour: 'slate' },
  { slug: 'shopping', name: 'Shopping', kind: 'expense', icon: 'shopping-bag', colour: 'violet' },
  { slug: 'bills', name: 'Bills & utilities', kind: 'expense', icon: 'receipt', colour: 'cyan' },
  { slug: 'rent', name: 'Rent', kind: 'expense', icon: 'house', colour: 'coral' },
  { slug: 'health', name: 'Health', kind: 'expense', icon: 'heart-pulse', colour: 'coral' },
  { slug: 'entertainment', name: 'Entertainment', kind: 'expense', icon: 'clapperboard', colour: 'violet' },
  { slug: 'subscriptions', name: 'Subscriptions', kind: 'expense', icon: 'repeat', colour: 'gold' },
  { slug: 'travel', name: 'Travel', kind: 'expense', icon: 'plane', colour: 'sky' },
  { slug: 'education', name: 'Education', kind: 'expense', icon: 'graduation-cap', colour: 'cyan' },
  { slug: 'personal', name: 'Personal care', kind: 'expense', icon: 'sparkles', colour: 'gold' },
  { slug: 'gifts', name: 'Gifts & donations', kind: 'expense', icon: 'gift', colour: 'coral' },
  { slug: 'investments', name: 'Investments', kind: 'expense', icon: 'trending-up', colour: 'emerald' },
  { slug: 'fees', name: 'Fees & charges', kind: 'expense', icon: 'badge-percent', colour: 'slate' },
  { slug: 'other', name: 'Other', kind: 'expense', icon: 'circle', colour: 'slate' },
  { slug: 'salary', name: 'Salary', kind: 'income', icon: 'briefcase', colour: 'emerald' },
  { slug: 'refunds', name: 'Refunds & cashback', kind: 'income', icon: 'undo-2', colour: 'emerald' },
  { slug: 'other-income', name: 'Other income', kind: 'income', icon: 'plus-circle', colour: 'emerald' },
  { slug: 'transfers', name: 'Transfers', kind: 'transfer', icon: 'arrow-left-right', colour: 'slate' },
];

/** ₹1,23,456.78 — Indian grouping for INR, the locale's for others. */
export function formatMoney(minor: number, currency = 'INR', opts: { sign?: boolean } = {}): string {
  const f = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(Math.abs(minor) / 100);
  return opts.sign && minor < 0 ? `−${f}` : f;
}
