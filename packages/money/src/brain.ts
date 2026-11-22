import { monthOf, prevMonth, subscriptions, type Tx } from './insights';
import { merchantKey } from './review';

/**
 * The money brain (spec 0013): what ORVYN learns from the person's own history, rules only, no AI.
 *  - merchant profiles: how often, how much, filed as what, paid from which account;
 *  - smart fill: merchants for a typed name or for an amount, and how to file a new payment;
 *  - insights: pace and forecast, safe to spend, unusual charges, duplicates, price changes, new subscriptions,
 *    upcoming bills, top merchants, payments without a category.
 * Everything here is a pure function of the person's records, the same on the server and in the web app.
 */

export interface BrainTx extends Tx {
  accountId: string | null;
  currency?: string;
  reviewed?: boolean;
  dedupeKey?: string | null;
}

export interface MerchantProfile {
  key: string;
  /** the latest way it was written */
  merchant: string;
  count: number;
  totalMinor: number;
  medianMinor: number;
  lastAmountMinor: number;
  lastAt: string;
  /** the category it was filed as most often, and how consistently (0..1 of the filed ones) */
  categoryId: string | null;
  categoryShare: number;
  filed: number;
  /** the account most often used */
  accountId: string | null;
  direction: 'debit' | 'credit';
  /** distinct amounts, most frequent first (for amount chips) */
  amounts: number[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const mode = <T>(xs: T[]): [T | null, number] => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return [best, n];
};

/** One profile per merchant (by merchantKey), from every non-transfer payment that names one. */
export function merchantProfiles(txs: BrainTx[]): Map<string, MerchantProfile> {
  const by = new Map<string, BrainTx[]>();
  for (const t of txs) {
    if (t.transfer || !t.merchant.trim()) continue;
    const k = merchantKey(t.merchant);
    if (!k) continue;
    const list = by.get(k);
    if (list) list.push(t);
    else by.set(k, [t]);
  }
  const out = new Map<string, MerchantProfile>();
  for (const [key, list] of by) {
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const last = list[0]!;
    const filedCats = list.map((t) => t.categoryId).filter((c): c is string => !!c);
    const [cat, catN] = mode(filedCats);
    const [acct] = mode(list.map((t) => t.accountId).filter((a): a is string => !!a));
    const [dir] = mode(list.map((t) => t.direction));
    const amountCounts = new Map<number, number>();
    for (const t of list) amountCounts.set(t.amountMinor, (amountCounts.get(t.amountMinor) ?? 0) + 1);
    out.set(key, {
      key,
      merchant: last.merchant,
      count: list.length,
      totalMinor: list.reduce((a, t) => a + t.amountMinor, 0),
      medianMinor: median(list.map((t) => t.amountMinor)),
      lastAmountMinor: last.amountMinor,
      lastAt: last.occurredAt,
      categoryId: cat,
      categoryShare: filedCats.length ? catN / filedCats.length : 0,
      filed: filedCats.length,
      accountId: acct,
      direction: dir ?? 'debit',
      amounts: [...amountCounts.entries()]
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])
        .map(([a]) => a)
        .slice(0, 4),
    });
  }
  return out;
}

/**
 * How history says to file a payment to this merchant: only when it was filed the same way at least 3 times and at
 * least 80% of the time — confident enough to do it without asking.
 */
export function historyCategory(p: MerchantProfile | undefined | null): {
  categoryId: string;
  times: number;
} | null {
  if (!p || !p.categoryId || p.filed < 3 || p.categoryShare < 0.8) return null;
  return { categoryId: p.categoryId, times: Math.round(p.filed * p.categoryShare) };
}

const score = (p: MerchantProfile, now: number) => {
  const days = Math.max(1, (now - Date.parse(p.lastAt)) / 86_400_000);
  return p.count * 2 + 30 / days;
};

/** Merchants matching what's typed (start of a word first), the ones used often and lately first. */
export function suggestMerchants(
  profiles: Map<string, MerchantProfile>,
  typed: string,
  now = Date.now(),
  n = 5,
): MerchantProfile[] {
  const q = merchantKey(typed);
  const all = [...profiles.values()];
  if (!q) return all.sort((a, b) => score(b, now) - score(a, now)).slice(0, n);
  return all
    .map((p) => {
      const words = p.key.split(' ');
      const rank = p.key.startsWith(q)
        ? 3
        : words.some((w) => w.startsWith(q))
          ? 2
          : p.key.includes(q)
            ? 1
            : 0;
      return { p, rank };
    })
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank - a.rank || score(b.p, now) - score(a.p, now))
    .map((x) => x.p)
    .slice(0, n);
}

/** Merchants this amount was paid to before (exactly, or within 3% for 3+ visits), most visits first. */
export function merchantsForAmount(
  profiles: Map<string, MerchantProfile>,
  amountMinor: number,
  n = 4,
): MerchantProfile[] {
  if (amountMinor <= 0) return [];
  return [...profiles.values()]
    .filter(
      (p) =>
        p.amounts.includes(amountMinor) ||
        (p.count >= 3 && Math.abs(p.medianMinor - amountMinor) <= p.medianMinor * 0.03),
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ------------------------------------------------------------------ insights

/**
 * Charges that came once a month at a steady price (within 3% in at least 2 earlier months of the last 4) and are
 * there this month too — with this month's price, which may have changed (≥ 5% and ≥ ₹10 counts as a change).
 */
export function steadyCharges(txs: Tx[], month: string, timeZone: string) {
  const months = [
    month,
    prevMonth(month),
    prevMonth(prevMonth(month)),
    prevMonth(prevMonth(prevMonth(month))),
  ];
  const by = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.direction !== 'debit' || t.transfer || !t.merchant) continue;
    if (!months.includes(monthOf(t.occurredAt, timeZone))) continue;
    const k = merchantKey(t.merchant);
    const l = by.get(k);
    if (l) l.push(t);
    else by.set(k, [t]);
  }
  const out: { merchant: string; beforeMinor: number; latestMinor: number; months: number }[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const latest = list[0]!;
    if (monthOf(latest.occurredAt, timeZone) !== month) continue;
    const earlier = list.slice(1);
    const earlierMonths = new Set(earlier.map((t) => monthOf(t.occurredAt, timeZone)));
    if (earlierMonths.size < 2 || earlier.length > earlierMonths.size + 1) continue; // monthly, not every day
    const before = median(earlier.map((t) => t.amountMinor));
    if (earlier.some((t) => Math.abs(t.amountMinor - before) > before * 0.03)) continue;
    const changed = Math.abs(latest.amountMinor - before) >= Math.max(before * 0.05, 1_000);
    out.push({
      merchant: latest.merchant,
      beforeMinor: before,
      latestMinor: changed ? latest.amountMinor : before,
      months: earlierMonths.size + 1,
    });
  }
  return out.sort((a, b) => b.latestMinor - a.latestMinor);
}

export interface Upcoming {
  title: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  /** YYYY-MM-DD */
  date: string;
}

export interface Insight {
  id: string;
  kind:
    | 'pace'
    | 'safe'
    | 'unusual'
    | 'duplicate'
    | 'price'
    | 'new-subscription'
    | 'upcoming'
    | 'top'
    | 'uncategorised'
    | 'weekend'
    | 'streak';
  tone: 'good' | 'info' | 'warn' | 'alert';
  title: string;
  body: string;
  amountMinor?: number;
  merchant?: string;
  txIds?: string[];
  /** what a tap does */
  action?:
    | { kind: 'open-tx'; txId: string }
    | { kind: 'open-merchant'; merchant: string }
    | { kind: 'track-recurring'; merchant: string; amountMinor: number }
    | { kind: 'categorise' }
    | { kind: 'review-duplicates'; txIds: string[] };
}

export interface Pace {
  month: string;
  day: number;
  daysInMonth: number;
  spentMinor: number;
  /** what last month had spent by the same day */
  lastMonthSameDayMinor: number;
  lastMonthMinor: number;
  /** where this month is heading: today's pace for the days left, plus bills still to come */
  projectedMinor: number;
  upcomingMinor: number;
  budgetMinor: number | null;
  /** per day for the rest of the month to stay inside the budget (null without one) */
  safePerDayMinor: number | null;
}

const fmt = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    Math.round(minor / 100),
  );
const dayIn = (iso: string, tz: string) =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit' }).format(new Date(iso)));
const weekdayIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(new Date(iso));

/** The whole picture for one month: the pace numbers and a short, ordered list of cards worth a look. */
export function moneyInsights(input: {
  txs: BrainTx[];
  month: string;
  timeZone: string;
  now: Date;
  /** the overall monthly budget in force, if any */
  budgetMinor: number | null;
  /** bills and income still to come this month (from repeating entries) */
  upcoming: Upcoming[];
  /** merchants already tracked as repeating (so they aren't suggested again) */
  tracked: string[];
}): { pace: Pace; cards: Insight[] } {
  const { txs, month, timeZone: tz, now } = input;
  const live = txs.filter((t) => !t.transfer);
  const inMonth = live.filter((t) => monthOf(t.occurredAt, tz) === month);
  const debits = inMonth.filter((t) => t.direction === 'debit');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nowMonth = monthOf(now.toISOString(), tz);
  const day = nowMonth === month ? dayIn(now.toISOString(), tz) : nowMonth > month ? daysInMonth : 0;
  const spent = debits.reduce((a, t) => a + t.amountMinor, 0);
  const prev = live.filter((t) => t.direction === 'debit' && monthOf(t.occurredAt, tz) === prevMonth(month));
  const lastMonthMinor = prev.reduce((a, t) => a + t.amountMinor, 0);
  const lastSameDay = prev
    .filter((t) => dayIn(t.occurredAt, tz) <= day)
    .reduce((a, t) => a + t.amountMinor, 0);
  const upcoming = input.upcoming.filter((u) => u.date.startsWith(month));
  const upcomingMinor = upcoming
    .filter((u) => u.direction === 'debit')
    .reduce((a, u) => a + u.amountMinor, 0);
  const daysLeft = Math.max(0, daysInMonth - day);
  // the everyday pace leaves out one-off big payments (rent-sized), so one bill doesn't skew the forecast
  const big = median(debits.map((t) => t.amountMinor)) * 8;
  const everyday = debits
    .filter((t) => t.amountMinor <= Math.max(big, 1))
    .reduce((a, t) => a + t.amountMinor, 0);
  const perDay = day > 0 ? everyday / day : 0;
  const projected = Math.round(spent + perDay * daysLeft + upcomingMinor);
  const budget = input.budgetMinor;
  const safe =
    budget !== null && daysLeft > 0
      ? Math.max(0, Math.floor((budget - spent - upcomingMinor) / daysLeft))
      : null;
  const pace: Pace = {
    month,
    day,
    daysInMonth,
    spentMinor: spent,
    lastMonthSameDayMinor: lastSameDay,
    lastMonthMinor,
    projectedMinor: projected,
    upcomingMinor,
    budgetMinor: budget,
    safePerDayMinor: safe,
  };

  const cards: Insight[] = [];
  const isCurrent = nowMonth === month;

  // -------- pace
  if (isCurrent && day >= 3 && (budget !== null || lastMonthMinor > 0)) {
    const ref = budget ?? lastMonthMinor;
    const over = projected - ref;
    const against = budget !== null ? 'your budget' : 'last month';
    cards.push({
      id: 'pace',
      kind: 'pace',
      tone: over > ref * 0.05 ? 'warn' : 'good',
      title:
        over > ref * 0.05
          ? `Heading for ${fmt(projected)} — ${fmt(over)} over ${against}`
          : `On track: about ${fmt(projected)} by month end`,
      body:
        lastSameDay > 0
          ? `${fmt(spent)} so far; by this day last month it was ${fmt(lastSameDay)}.`
          : `${fmt(spent)} so far this month.`,
      amountMinor: projected,
    });
  }
  if (isCurrent && safe !== null) {
    cards.push({
      id: 'safe',
      kind: 'safe',
      tone: safe === 0 ? 'alert' : 'info',
      title: safe === 0 ? 'The budget is used up for this month' : `${fmt(safe)} a day is safe to spend`,
      body:
        safe === 0
          ? `Spent ${fmt(spent)} of ${fmt(budget!)}${upcomingMinor ? `, and ${fmt(upcomingMinor)} of bills still to come` : ''}.`
          : `For the ${daysLeft} days left, after ${upcomingMinor ? `${fmt(upcomingMinor)} of bills still to come` : 'what is spent'}.`,
      amountMinor: safe,
    });
  }

  // -------- unusual: far above what this merchant usually costs
  const profiles = merchantProfiles(live);
  const unusual = debits
    .map((t) => {
      const p = profiles.get(merchantKey(t.merchant));
      if (!p || p.count < 4) return null;
      const others = live
        .filter((x) => x.id !== t.id && merchantKey(x.merchant) === p.key && x.direction === 'debit')
        .map((x) => x.amountMinor);
      const typical = median(others);
      if (!typical || t.amountMinor < typical * 2.5 || t.amountMinor - typical < 50_000) return null;
      return { t, typical };
    })
    .filter((x): x is { t: BrainTx; typical: number } => !!x)
    .sort((a, b) => b.t.amountMinor / b.typical - a.t.amountMinor / a.typical)
    .slice(0, 2);
  for (const { t, typical } of unusual)
    cards.push({
      id: `unusual-${t.id}`,
      kind: 'unusual',
      tone: 'warn',
      title: `${fmt(t.amountMinor)} at ${t.merchant} — usually ${fmt(typical)}`,
      body: `${(t.amountMinor / typical).toFixed(1)}× your usual on ${weekdayIn(t.occurredAt, tz)}. Worth a look.`,
      amountMinor: t.amountMinor,
      merchant: t.merchant,
      txIds: [t.id],
      action: { kind: 'open-tx', txId: t.id },
    });

  // -------- possible duplicates: same merchant and amount within 30 minutes, not the same payment
  const dupes: [BrainTx, BrainTx][] = [];
  const sorted = [...debits].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (Date.parse(b.occurredAt) - Date.parse(a.occurredAt) > 30 * 60_000) break;
      if (
        a.amountMinor === b.amountMinor &&
        a.merchant &&
        merchantKey(a.merchant) === merchantKey(b.merchant) &&
        (!a.dedupeKey || a.dedupeKey !== b.dedupeKey)
      )
        dupes.push([a, b]);
    }
  }
  for (const [a, b] of dupes.slice(0, 2))
    cards.push({
      id: `dup-${a.id}-${b.id}`,
      kind: 'duplicate',
      tone: 'alert',
      title: `Charged twice? ${fmt(a.amountMinor)} at ${a.merchant}`,
      body: `Two payments ${Math.max(1, Math.round((Date.parse(b.occurredAt) - Date.parse(a.occurredAt)) / 60_000))} min apart. Delete one if it was the same payment.`,
      amountMinor: a.amountMinor,
      merchant: a.merchant,
      txIds: [a.id, b.id],
      action: { kind: 'review-duplicates', txIds: [a.id, b.id] },
    });

  // -------- subscriptions: price changes, and new ones not tracked yet
  const steady = steadyCharges(live, month, tz);
  for (const s of steady.filter((s) => s.latestMinor !== s.beforeMinor))
    cards.push({
      id: `price-${merchantKey(s.merchant)}`,
      kind: 'price',
      tone: s.latestMinor > s.beforeMinor ? 'warn' : 'good',
      title: `${s.merchant} ${s.latestMinor > s.beforeMinor ? 'went up' : 'went down'}: ${fmt(s.beforeMinor)} → ${fmt(s.latestMinor)}`,
      body:
        s.latestMinor > s.beforeMinor
          ? `That's ${fmt((s.latestMinor - s.beforeMinor) * 12)} more a year.`
          : `You save ${fmt((s.beforeMinor - s.latestMinor) * 12)} a year.`,
      merchant: s.merchant,
      action: { kind: 'open-merchant', merchant: s.merchant },
    });
  const tracked = new Set(input.tracked.map(merchantKey));
  const candidates = [
    ...steady.map((s) => ({ merchant: s.merchant, amountMinor: s.latestMinor, months: s.months })),
    ...subscriptions(live, month, tz),
  ];
  const seenSub = new Set<string>();
  for (const s of candidates) {
    const k = merchantKey(s.merchant);
    if (tracked.has(k) || seenSub.has(k)) continue;
    seenSub.add(k);
    if (seenSub.size > 2) break;
    cards.push({
      id: `sub-${k}`,
      kind: 'new-subscription',
      tone: 'info',
      title: `${s.merchant} looks like a subscription`,
      body: `About ${fmt(s.amountMinor)} in ${s.months} of the last 4 months. Track it to see it coming.`,
      merchant: s.merchant,
      amountMinor: s.amountMinor,
      action: { kind: 'track-recurring', merchant: s.merchant, amountMinor: s.amountMinor },
    });
  }

  // -------- bills in the next 7 days
  if (isCurrent) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    const week = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
      new Date(now.getTime() + 7 * 86_400_000),
    );
    const soon = input.upcoming.filter((u) => u.direction === 'debit' && u.date >= today && u.date <= week);
    if (soon.length)
      cards.push({
        id: 'upcoming',
        kind: 'upcoming',
        tone: 'info',
        title: `${soon.length === 1 ? soon[0]!.title : `${soon.length} bills`} due this week · ${fmt(soon.reduce((a, u) => a + u.amountMinor, 0))}`,
        body: soon
          .slice(0, 4)
          .map((u) => `${u.title} ${fmt(u.amountMinor)} on ${weekdayIn(`${u.date}T12:00:00Z`, 'UTC')}`)
          .join(' · '),
        amountMinor: soon.reduce((a, u) => a + u.amountMinor, 0),
      });
  }

  // -------- where it went: the merchant you went to most
  const monthProfiles = merchantProfiles(debits);
  const top = [...monthProfiles.values()].sort((a, b) => b.count - a.count || b.totalMinor - a.totalMinor)[0];
  if (top && top.count >= 4)
    cards.push({
      id: `top-${top.key}`,
      kind: 'top',
      tone: 'info',
      title: `${top.merchant} ${top.count} times · ${fmt(top.totalMinor)}`,
      body: `Your most frequent place this month, about ${fmt(Math.round(top.totalMinor / top.count))} a visit.`,
      merchant: top.merchant,
      amountMinor: top.totalMinor,
      action: { kind: 'open-merchant', merchant: top.merchant },
    });

  // -------- weekends
  const weekend = debits.filter((t) => ['Sat', 'Sun'].includes(weekdayIn(t.occurredAt, tz)));
  const weSum = weekend.reduce((a, t) => a + t.amountMinor, 0);
  if (debits.length >= 15 && spent > 0 && weSum / spent >= 0.45)
    cards.push({
      id: 'weekend',
      kind: 'weekend',
      tone: 'info',
      title: `${Math.round((weSum / spent) * 100)}% of spending happens on weekends`,
      body: `${fmt(weSum)} on Saturdays and Sundays this month.`,
      amountMinor: weSum,
    });

  // -------- payments without a category
  const loose = inMonth.filter((t) => !t.categoryId);
  if (loose.length >= 3)
    cards.push({
      id: 'uncategorised',
      kind: 'uncategorised',
      tone: 'info',
      title: `${loose.length} payments have no category`,
      body: `${fmt(loose.reduce((a, t) => a + t.amountMinor, 0))} not counted in any category yet. File them in a minute.`,
      txIds: loose.map((t) => t.id),
      action: { kind: 'categorise' },
    });

  // most useful first: alerts, then warnings, then the rest in the order above
  const rank = { alert: 0, warn: 1, good: 2, info: 3 } as const;
  const order = (c: Insight) => (c.kind === 'pace' ? -2 : c.kind === 'safe' ? -1 : rank[c.tone]);
  cards.sort((a, b) => order(a) - order(b));
  return { pace, cards: cards.slice(0, 10) };
}
