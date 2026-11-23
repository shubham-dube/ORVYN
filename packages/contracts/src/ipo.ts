import { z } from 'zod';

/** The IPO desk and the IPO Pool (spec 0010). Money in the Pool is in paise (minor units), like Money. */

export const IPO_TYPES = ['mainboard', 'sme'] as const;
export const IPO_STATUSES = ['upcoming', 'open', 'closed', 'listed'] as const;
export const IPO_CATEGORIES = ['retail', 'snii'] as const;
export type IpoCategory = (typeof IPO_CATEGORIES)[number];

export const IPO_EVENTS = [
  'announced',
  'opens',
  'closes',
  'gmp',
  'subscription',
  'allotment',
  'listing',
  /** ask "Will you apply?" and follow up on the close, allotment and listing days (spec 0016 A5) */
  'decide',
] as const;
export type IpoEvent = (typeof IPO_EVENTS)[number];

/** What I decided about an IPO, and how it went (spec 0016 A5). */
export const IPO_DECISIONS = ['applying', 'skipped', 'applied', 'allotted', 'not_allotted'] as const;
export type IpoDecision = (typeof IPO_DECISIONS)[number];
export const IpoDecisionBody = z.object({ decision: z.enum(IPO_DECISIONS).nullable() });

export const IpoSettings = z.object({
  /** only IPOs at least this big (₹ crore); 0 = any */
  minIssueSizeCr: z.number().min(0).max(100_000).default(0),
  types: z.array(z.enum(IPO_TYPES)).min(1).default(['mainboard']),
  /** only IPOs whose GMP is at least this % of the price (null = any, also when GMP is unknown) */
  minGmpPct: z.number().min(-100).max(500).nullable().default(null),
  onlyStarred: z.boolean().default(false),
  events: z.array(z.enum(IPO_EVENTS)).default([...IPO_EVENTS]),
  /** GMP moved by at least this many percentage points since the last ping */
  gmpMovePct: z.number().min(1).max(100).default(5),
  maxPerDay: z.number().int().min(1).max(20).default(6),
  /** the desk shows SME IPOs too (spec 0016 A1); the desk is mainboard-only otherwise */
  showSme: z.boolean().default(false),
  /** "I'll apply" makes a task due on the close day at this time (D-0016-3) */
  applyBy: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('14:00'),
});
export type IpoSettings = z.infer<typeof IpoSettings>;

export interface IpoSubscription {
  total: number | null;
  qib: number | null;
  nii: number | null;
  snii: number | null;
  bnii: number | null;
  retail: number | null;
  employee: number | null;
  shareholder: number | null;
  /** applications by category when the exchange reports them */
  applications: { total?: number | null; retail?: number | null; snii?: number | null } | null;
  updatedAt: string | null;
}

/** Odds for one category (spec 0010 §Allotment model). */
export interface IpoOdds {
  category: IpoCategory;
  /** minimum application: lots and amount (₹) */
  minLots: number;
  minAmount: number;
  /** lots (minimum applications) the category can allot */
  lotsOnOffer: number | null;
  /** chance per application, 0–1; null before bidding */
  chance: number | null;
  /** 'exact' (from applications), 'estimate' (from the multiple), 'none' (not yet) */
  basis: 'exact' | 'estimate' | 'none';
}

export interface IpoIssueView {
  id: string;
  slug: string;
  name: string;
  type: (typeof IPO_TYPES)[number];
  status: (typeof IPO_STATUSES)[number];
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  refundDate: string | null;
  listingDate: string | null;
  priceMin: number | null;
  priceMax: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  gmp: number | null;
  gmpPct: number | null;
  gmpUpdatedAt: string | null;
  estListingPrice: number | null;
  subscription: IpoSubscription | null;
  listingPrice: number | null;
  /** spec 0016: what one lot costs, the logo and the rest of the calendar's facts */
  minInvestment: number | null;
  logo: string | null;
  faceValue: number | null;
  listingOn: string | null;
  saleType: string | null;
  listingGainPct: number | null;
  cmp: number | null;
  kostak: number | null;
  sauda: number | null;
  /** GMP × lot size: what one lot gains at today's GMP */
  gainPerLot: number | null;
  /** the detail endpoint's extras (paid plans add company, financials, lead managers…) */
  details: IpoDetails | null;
  decision: IpoDecision | null;
  taskId: string | null;
  source: string;
  sourceUrl: string | null;
  manual: string[];
  starred: boolean;
  odds: IpoOdds[];
  /** with the Pool: what your accounts can expect */
  pool: {
    accounts: number;
    expectedAllotments: number | null;
    chanceAtLeastOne: number | null;
    expectedGain: number | null;
    cardCost: number;
  } | null;
  verdict: string;
}

export interface IpoDetails {
  creditToDematDate?: string | null;
  employeeDiscount?: string | null;
  about?: string | null;
  strengths?: string[];
  risks?: string[];
  objects?: string[];
  financials?: { headers: string[]; rows: { metric: string; data: (string | number | null)[] }[]; unit?: string } | null;
  leadManagers?: string[];
  registrar?: { name: string; statusPage?: string | null } | null;
  lotTable?: { label: string; lots: number | null; shares: number | null; amount: number | null }[];
  documents?: { label: string; url: string }[];
  /** what the plan left out */
  locked?: string[];
}

export const ManualFigures = z.object({
  gmp: z.number().min(-10_000).max(100_000).nullable().optional(),
  subscription: z
    .object({
      total: z.number().min(0).nullable().optional(),
      qib: z.number().min(0).nullable().optional(),
      nii: z.number().min(0).nullable().optional(),
      snii: z.number().min(0).nullable().optional(),
      bnii: z.number().min(0).nullable().optional(),
      retail: z.number().min(0).nullable().optional(),
      retailApplications: z.number().int().min(0).nullable().optional(),
    })
    .optional(),
  listingPrice: z.number().min(0).nullable().optional(),
});
export type ManualFigures = z.infer<typeof ManualFigures>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const NewIssue = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(IPO_TYPES).default('mainboard'),
  openDate: date,
  closeDate: date,
  allotmentDate: date.nullable().default(null),
  listingDate: date.nullable().default(null),
  priceMin: z.number().positive().max(100_000).nullable().default(null),
  priceMax: z.number().positive().max(100_000),
  lotSize: z.number().int().positive().max(100_000),
  issueSizeCr: z.number().positive().max(100_000),
});
export type NewIssue = z.infer<typeof NewIssue>;

// ------------------------------------------------------------------ the Pool

export const SHARE_RULES = ['none', 'fixed', 'percent'] as const;
export const ShareRule = z.object({
  kind: z.enum(SHARE_RULES).default('none'),
  /** fixed: ₹ per allotment; percent: % of the gain */
  value: z.number().min(0).max(1_000_000).default(0),
});
export type ShareRule = z.infer<typeof ShareRule>;

export const PartnerFields = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).default(''),
  upi: z.string().trim().max(80).default(''),
  relation: z.string().trim().max(40).default(''),
  categories: z.array(z.enum(IPO_CATEGORIES)).min(1).default(['retail']),
  share: ShareRule.default({}),
  active: z.boolean().default(true),
  notes: z.string().max(1000).default(''),
});
export type PartnerFields = z.infer<typeof PartnerFields>;

export const SOURCE_KINDS = ['self', 'family', 'card', 'other'] as const;
export const SourceFields = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(SOURCE_KINDS).default('self'),
  /** what it costs to use this money, % of the amount (card cash ≈ 2–3) */
  feePct: z.number().min(0).max(20).default(0),
  /** money that has to be paid back (borrowed from someone) */
  repay: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type SourceFields = z.infer<typeof SourceFields>;

export const APPLICATION_STATUSES = [
  'planned',
  'funded',
  'applied',
  'mandate',
  'allotted',
  'not_allotted',
  'sold',
  'settled',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const NewRound = z.object({
  issueId: z.string().uuid(),
  partnerIds: z.array(z.string().uuid()).min(1).max(100),
  category: z.enum(IPO_CATEGORIES).default('retail'),
  /** lots per application (default: the category's minimum) */
  lots: z.number().int().min(1).max(1000).optional(),
  note: z.string().max(500).default(''),
});
export type NewRound = z.infer<typeof NewRound>;

export const ApplicationUpdate = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  allottedLots: z.number().int().min(0).max(1000).nullable().optional(),
  /** ₹ per share at sale */
  soldPrice: z.number().min(0).max(1_000_000).nullable().optional(),
  /** brokerage and charges at sale, ₹ */
  saleCosts: z.number().min(0).max(1_000_000).optional(),
  /** the partner's share, ₹ (defaults to their rule) */
  share: z.number().min(0).max(10_000_000).nullable().optional(),
});
export type ApplicationUpdate = z.infer<typeof ApplicationUpdate>;

export const LEDGER_KINDS = ['fund', 'return', 'repay', 'cost', 'share', 'adjust'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const PARTY_KINDS = ['me', 'source', 'partner', 'outside'] as const;

/** One movement. `fund`: a source → a partner; `return`: a partner → you (or → a source); `repay`: you → a source;
 * `share`: a partner keeps their profit share; `cost`: money lost to fees; `adjust`: a correction. Amounts in ₹. */
export const LedgerEntryInput = z.object({
  kind: z.enum(LEDGER_KINDS),
  amount: z.number().positive().max(100_000_000),
  sourceId: z.string().uuid().nullable().default(null),
  partnerId: z.string().uuid().nullable().default(null),
  roundId: z.string().uuid().nullable().default(null),
  applicationId: z.string().uuid().nullable().default(null),
  method: z.string().trim().max(30).default('UPI'),
  note: z.string().max(500).default(''),
  at: z.string().datetime({ offset: true }).optional(),
  /** adjust: + adds to the partner's float, − takes away */
  direction: z.enum(['in', 'out']).default('in'),
});
export type LedgerEntryInput = z.infer<typeof LedgerEntryInput>;

export const PARTNER_ACTIONS = ['applied', 'mandate', 'allotted', 'not_allotted', 'sold'] as const;
export const PartnerAction = z.object({
  action: z.enum(PARTNER_ACTIONS),
  lots: z.number().int().min(1).max(1000).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
});
export type PartnerAction = z.infer<typeof PartnerAction>;
