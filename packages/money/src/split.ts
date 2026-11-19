/**
 * Split (spec 0011 part B, ADR-0015): shares of a shared expense, balances and the fewest transfers to settle.
 * Everything in paise (integers); rounding never loses or invents a paisa.
 */

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export interface SplitInput {
  /** paise */
  total: number;
  method: SplitMethod;
  /** equal: value ignored; exact: paise; percent: 0–100; shares: weights */
  among: { memberId: string; value: number }[];
}

export class SplitError extends Error {}

/**
 * Divides `total` among weights. Each part is floored; the leftover paise go one each to the largest remainders
 * (ties: listing order), so the parts always add up to the total.
 */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new SplitError('nothing to split by');
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    parts[o.i]!++;
    left--;
  }
  return parts;
}

/** Each member's share (paise) of one expense. */
export function shares(s: SplitInput): Map<string, number> {
  if (!s.among.length) throw new SplitError('split among at least one person');
  if (!Number.isInteger(s.total) || s.total <= 0) throw new SplitError('amount must be positive');
  const ids = s.among.map((a) => a.memberId);
  if (new Set(ids).size !== ids.length) throw new SplitError('someone is listed twice');
  let parts: number[];
  switch (s.method) {
    case 'equal':
      parts = apportion(
        s.total,
        s.among.map(() => 1),
      );
      break;
    case 'shares':
      if (s.among.some((a) => a.value < 0)) throw new SplitError('shares cannot be negative');
      parts = apportion(
        s.total,
        s.among.map((a) => a.value),
      );
      break;
    case 'percent': {
      const sum = s.among.reduce((a, b) => a + b.value, 0);
      if (Math.abs(sum - 100) > 0.001) throw new SplitError(`percentages add up to ${sum}, not 100`);
      parts = apportion(
        s.total,
        s.among.map((a) => a.value),
      );
      break;
    }
    case 'exact': {
      parts = s.among.map((a) => Math.round(a.value));
      const sum = parts.reduce((a, b) => a + b, 0);
      if (sum !== s.total) throw new SplitError(`the parts add up to ${sum / 100}, not ${s.total / 100}`);
      break;
    }
  }
  return new Map(ids.map((id, i) => [id, parts[i]!]));
}

export interface LedgerExpense {
  /** paise each person put in (contributions add up to the total) */
  paid: { memberId: string; amount: number }[];
  /** paise each person's share */
  owed: { memberId: string; amount: number }[];
}
export interface LedgerSettlement {
  from: string;
  to: string;
  amount: number;
}

/** Net per member: + should get money, − owes. Paid − share + paid back to others − received back. */
export function balances(members: string[], expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const net = new Map(members.map((m) => [m, 0]));
  const add = (m: string, v: number) => net.set(m, (net.get(m) ?? 0) + v);
  for (const e of expenses) {
    for (const p of e.paid) add(p.memberId, p.amount);
    for (const o of e.owed) add(o.memberId, -o.amount);
  }
  for (const s of settlements) {
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return net;
}

/**
 * The fewest transfers that clear everyone, by matching the largest debtor with the largest creditor until all are
 * square (at most n − 1 transfers). Deterministic: ties go by member order.
 */
export function settleUp(net: Map<string, number>): LedgerSettlement[] {
  const order = [...net.keys()];
  const pos = (id: string) => order.indexOf(id);
  const debtors = [...net].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = [...net].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const out: LedgerSettlement[] = [];
  const sort = (xs: { id: string; v: number }[]) => xs.sort((a, b) => b.v - a.v || pos(a.id) - pos(b.id));
  while (debtors.length && creditors.length) {
    sort(debtors);
    sort(creditors);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const amount = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount });
    d.v -= amount;
    c.v -= amount;
    if (!d.v) debtors.shift();
    if (!c.v) creditors.shift();
  }
  return out;
}
