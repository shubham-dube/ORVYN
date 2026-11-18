/** Month numbers for people (spec 0003): totals, by category, budgets, subscriptions and what changed. */
export interface Tx {
  id: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  occurredAt: string;
  merchant: string;
  categoryId: string | null;
  transfer: boolean;
}

/** YYYY-MM of an instant in a time zone. */
export function monthOf(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(
    new Date(iso),
  );
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

export const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};

export interface MonthSummary {
  month: string;
  spentMinor: number;
  earnedMinor: number;
  byCategory: { categoryId: string | null; spentMinor: number; count: number }[];
}

export function summarise(txs: Tx[], month: string, timeZone: string): MonthSummary {
  const mine = txs.filter((t) => !t.transfer && monthOf(t.occurredAt, timeZone) === month);
  const by = new Map<string | null, { spentMinor: number; count: number }>();
  let spent = 0;
  let earned = 0;
  for (const t of mine) {
    if (t.direction === 'credit') {
      earned += t.amountMinor;
      continue;
    }
    spent += t.amountMinor;
    const b = by.get(t.categoryId) ?? { spentMinor: 0, count: 0 };
    b.spentMinor += t.amountMinor;
    b.count++;
    by.set(t.categoryId, b);
  }
  return {
    month,
    spentMinor: spent,
    earnedMinor: earned,
    byCategory: [...by.entries()]
      .map(([categoryId, v]) => ({ categoryId, ...v }))
      .sort((a, b) => b.spentMinor - a.spentMinor),
  };
}

export interface BudgetIn {
  id: string;
  categoryId: string | null;
  amountMinor: number;
  from: string;
  archived?: boolean;
}

/** Budgets in force for a month (the latest one from or before it, per category) with what's used. */
export function budgetProgress(budgets: BudgetIn[], s: MonthSummary) {
  const live = new Map<string | null, BudgetIn>();
  for (const b of [...budgets]
    .filter((b) => !b.archived && b.from <= s.month)
    .sort((a, b) => a.from.localeCompare(b.from)))
    live.set(b.categoryId, b);
  return [...live.values()]
    .map((b) => {
      const used =
        b.categoryId === null
          ? s.spentMinor
          : (s.byCategory.find((c) => c.categoryId === b.categoryId)?.spentMinor ?? 0);
      return {
        budgetId: b.id,
        categoryId: b.categoryId,
        limitMinor: b.amountMinor,
        usedMinor: used,
        ratio: used / b.amountMinor,
      };
    })
    .sort((a, b) => (a.categoryId === null ? -1 : b.categoryId === null ? 1 : b.ratio - a.ratio)); // overall first
}

/** Subscriptions: the same merchant charged a similar amount in at least 3 of the last 4 months (or monthly so far). */
export function subscriptions(txs: Tx[], month: string, timeZone: string) {
  const months = [
    month,
    prevMonth(month),
    prevMonth(prevMonth(month)),
    prevMonth(prevMonth(prevMonth(month))),
  ];
  const byMerchant = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.direction !== 'debit' || t.transfer || !t.merchant) continue;
    if (!months.includes(monthOf(t.occurredAt, timeZone))) continue;
    const k = t.merchant.toLowerCase();
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]);
  }
  const out: { merchant: string; amountMinor: number; months: number; lastAt: string }[] = [];
  for (const list of byMerchant.values()) {
    const seen = new Set(list.map((t) => monthOf(t.occurredAt, timeZone)));
    if (seen.size < 3) continue;
    const amounts = list.map((t) => t.amountMinor).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)]!;
    if (amounts.some((a) => Math.abs(a - median) > median * 0.2)) continue; // varying spends aren't a subscription
    const last = list.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b));
    out.push({ merchant: last.merchant, amountMinor: median, months: seen.size, lastAt: last.occurredAt });
  }
  return out.sort((a, b) => b.amountMinor - a.amountMinor);
}

/** What changed versus last month, biggest moves first (only changes that matter: ≥ ₹500 and ≥ 20%). */
export function monthStory(txs: Tx[], month: string, timeZone: string) {
  const now = summarise(txs, month, timeZone);
  const before = summarise(txs, prevMonth(month), timeZone);
  const ids = new Set([...now.byCategory, ...before.byCategory].map((c) => c.categoryId));
  const moves = [...ids]
    .map((id) => {
      const a = now.byCategory.find((c) => c.categoryId === id)?.spentMinor ?? 0;
      const b = before.byCategory.find((c) => c.categoryId === id)?.spentMinor ?? 0;
      return { categoryId: id, nowMinor: a, beforeMinor: b, deltaMinor: a - b };
    })
    .filter(
      (m) =>
        Math.abs(m.deltaMinor) >= 50_000 &&
        (m.beforeMinor === 0 || Math.abs(m.deltaMinor) / m.beforeMinor >= 0.2),
    )
    .sort((x, y) => Math.abs(y.deltaMinor) - Math.abs(x.deltaMinor));
  return { now, before, deltaMinor: now.spentMinor - before.spentMinor, moves };
}

/** A debit and a credit of the same amount between two of the person's own accounts within 10 minutes. */
export function findTransferPairs<T extends Tx & { accountId: string | null }>(txs: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  const used = new Set<string>();
  const debits = txs.filter((t) => t.direction === 'debit' && t.accountId);
  for (const d of debits) {
    const c = txs.find(
      (t) =>
        t.direction === 'credit' &&
        t.accountId &&
        t.accountId !== d.accountId &&
        t.amountMinor === d.amountMinor &&
        !used.has(t.id) &&
        Math.abs(Date.parse(t.occurredAt) - Date.parse(d.occurredAt)) <= 10 * 60_000,
    );
    if (c && !used.has(d.id)) {
      pairs.push([d, c]);
      used.add(d.id).add(c.id);
    }
  }
  return pairs;
}
