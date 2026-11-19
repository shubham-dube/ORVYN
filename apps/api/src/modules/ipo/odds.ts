import type { IpoCategory, IpoOdds, IpoSubscription } from '@orvyn/contracts';

/** What the odds need to know about an issue (spec 0010 §Allotment model). */
export interface OddsInput {
  type: 'mainboard' | 'sme';
  price: number | null;
  lotSize: number | null;
  issueSizeCr: number | null;
  /** shares offered by category, when the offer document says */
  shares?: Partial<Record<'retail' | 'snii', number>> | null;
  subscription: IpoSubscription | null;
}

const RETAIL_CAP = 200_000;
/** Retail quota of a mainboard issue (35%) and an SME issue's individual quota (35%); NII 15%, sNII a third of it. */
const QUOTA = { retail: 0.35, snii: 0.15 / 3 };

/** The minimum application in a category: retail 1 lot (SME: 2 lots); sNII the smallest number of lots above ₹2 lakh. */
export function minLots(
  category: IpoCategory,
  type: 'mainboard' | 'sme',
  price: number,
  lotSize: number,
): number {
  if (category === 'retail') return type === 'sme' ? 2 : 1;
  const lot = price * lotSize;
  return Math.floor(RETAIL_CAP / lot) + 1;
}

function times(s: IpoSubscription | null, category: IpoCategory): number | null {
  if (!s) return null;
  if (category === 'retail') return s.retail;
  return s.snii ?? s.nii;
}

export function odds(input: OddsInput): IpoOdds[] {
  const { price, lotSize } = input;
  if (!price || !lotSize) return [];
  return (['retail', 'snii'] as const).map((category) => {
    const ml = minLots(category, input.type, price, lotSize);
    const minShares = ml * lotSize;
    const shares =
      input.shares?.[category] ??
      (input.issueSizeCr ? Math.floor((input.issueSizeCr * 1e7 * QUOTA[category]) / price) : null);
    const lotsOnOffer = shares ? Math.floor(shares / minShares) : null;
    const t = times(input.subscription, category);
    const apps =
      category === 'retail'
        ? input.subscription?.applications?.retail
        : input.subscription?.applications?.snii;
    let chance: number | null = null;
    let basis: IpoOdds['basis'] = 'none';
    if (apps && lotsOnOffer) {
      chance = Math.min(1, lotsOnOffer / apps);
      basis = 'exact';
    } else if (t !== null && t !== undefined) {
      chance = t <= 1 ? 1 : 1 / t;
      basis = 'estimate';
    }
    return { category, minLots: ml, minAmount: Math.round(ml * lotSize * price), lotsOnOffer, chance, basis };
  });
}

/** n accounts in one category with the same chance p. */
export function across(n: number, p: number) {
  return { expected: n * p, atLeastOne: 1 - (1 - p) ** n };
}

/**
 * What a round is worth before it happens: expected allotments × the minimum application's shares × GMP, less the
 * card cost of money that still has to be sent (₹).
 */
export function expectedGain(o: {
  accounts: number;
  chance: number;
  minShares: number;
  gmp: number;
  cardCost: number;
}) {
  return Math.round(o.accounts * o.chance * o.minShares * o.gmp - o.cardCost);
}

/** A partner's share of a gain by their rule (₹); nothing on a loss. */
export function shareOf(rule: { kind: 'none' | 'fixed' | 'percent'; value: number }, gain: number): number {
  if (gain <= 0 || rule.kind === 'none') return 0;
  if (rule.kind === 'fixed') return Math.min(rule.value, gain);
  return Math.round((gain * rule.value) / 100);
}

/** One honest line, by rules — not advice. */
export function verdict(o: {
  status: string;
  gmpPct: number | null;
  chance: number | null;
  pool: { accounts: number; expectedAllotments: number | null; expectedGain: number | null } | null;
}): string {
  if (o.status === 'listed') return 'Listed.';
  if (o.status === 'closed') return 'Bidding closed — waiting for allotment.';
  const parts: string[] = [];
  if (o.gmpPct === null) parts.push('No GMP yet');
  else if (o.gmpPct >= 30) parts.push(`Strong GMP (${Math.round(o.gmpPct)}%)`);
  else if (o.gmpPct >= 10) parts.push(`GMP ${Math.round(o.gmpPct)}%`);
  else if (o.gmpPct > 0) parts.push(`Thin GMP (${o.gmpPct.toFixed(1)}%)`);
  else parts.push('GMP flat or negative — listing gains unlikely');
  if (o.chance !== null)
    parts.push(`retail odds ~${o.chance >= 0.995 ? 100 : Math.max(1, Math.round(o.chance * 100))}%`);
  if (o.pool?.expectedAllotments != null && o.pool.expectedGain != null)
    parts.push(
      `with ${o.pool.accounts} accounts ~${o.pool.expectedAllotments.toFixed(1)} allotments, ${
        o.pool.expectedGain >= 0 ? '+' : '−'
      }₹${Math.abs(o.pool.expectedGain).toLocaleString('en-IN')} expected after costs`,
    );
  return `${parts.join(' · ')}.`;
}
