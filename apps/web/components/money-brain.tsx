'use client';

import { type Category, formatMoney, type Transaction } from '@orvyn/contracts';
import {
  cleanMerchant,
  type Insight,
  merchantKey,
  type MerchantProfile,
  merchantProfiles,
  merchantsForAmount,
  moneyInsights,
  monthOf,
  suggestMerchants,
  type Upcoming,
} from '@orvyn/money';
import { occurrences } from '@orvyn/today-plan';
import {
  CalendarClock,
  Copy,
  Gauge,
  History,
  PartyPopper,
  Pencil,
  Repeat,
  ShieldCheck,
  Sparkles,
  Store,
  Tags,
  Trash2,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Glass, Label, Sheet, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useMoney } from '@/lib/money';
import { usePick } from './pick';

/**
 * The money brain on the web (spec 0013): everything is computed here from the local mirror with the same pure
 * functions the server uses (packages/money/src/brain.ts) — instant, and offline too.
 */

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const colour = (c?: Category | null) => `var(--orv-label-${c?.colour ?? 'slate'})`;

export function useProfiles() {
  const { transactions } = useMoney();
  return useMemo(() => merchantProfiles(transactions), [transactions]);
}

export function useMonthInsights(month: string) {
  const { transactions, budgets, recurring } = useMoney();
  return useMemo(() => {
    const tz = zone();
    const now = new Date();
    const overall = budgets
      .filter((b) => !b.archived && b.categoryId === null && b.from <= month)
      .sort((a, b) => b.from.localeCompare(a.from))[0];
    const [y, m] = month.split('-').map(Number) as [number, number];
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const current = monthOf(now.toISOString(), tz) === month;
    const from = current ? new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10) : `${month}-01`;
    const upcoming: Upcoming[] = [];
    for (const r of recurring.filter((r) => !r.paused))
      try {
        for (const o of occurrences(
          r.rrule,
          { date: r.startDate, timeZone: r.timeZone },
          new Date(`${from}T00:00:00Z`),
          new Date(`${end}T00:00:00Z`),
        ))
          if (!r.endDate || o.date! <= r.endDate)
            upcoming.push({
              title: r.title,
              amountMinor: r.amountMinor,
              direction: r.direction,
              date: o.date!,
            });
      } catch {
        /* a rule we can't read */
      }
    return moneyInsights({
      txs: transactions,
      month,
      timeZone: tz,
      now,
      budgetMinor: overall?.amountMinor ?? null,
      upcoming,
      tracked: recurring.flatMap((r) => [r.title, r.merchant].filter(Boolean)),
    });
  }, [transactions, budgets, recurring, month]);
}

const ICON: Record<string, React.ReactNode> = {
  unusual: <TriangleAlert size={16} />,
  duplicate: <Copy size={16} />,
  price: <TrendingUp size={16} />,
  'new-subscription': <Repeat size={16} />,
  upcoming: <CalendarClock size={16} />,
  top: <Store size={16} />,
  uncategorised: <Tags size={16} />,
  weekend: <PartyPopper size={16} />,
};
const TONE: Record<Insight['tone'], string> = {
  alert: 'var(--orv-danger)',
  warn: 'var(--orv-warning)',
  good: 'var(--orv-success)',
  info: 'var(--orv-accent)',
};
const CTA: Record<string, string> = {
  'open-tx': 'Look at it →',
  'open-merchant': 'See the history →',
  'track-recurring': 'Track it →',
  categorise: 'File them →',
  'review-duplicates': 'Check them →',
};

/** The month read for you: the pace bar, safe to spend, and the cards worth a look. */
export function InsightsPanel({
  month,
  onOpenTx,
  onTrack,
}: {
  month: string;
  onOpenTx(id: string): void;
  onTrack(seed: { merchant: string; amountMinor: number; day: number; categoryId: string | null }): void;
}) {
  const { pace, cards } = useMonthInsights(month);
  const { transactions } = useMoney();
  const [merchant, setMerchant] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [dupes, setDupes] = useState<string[] | null>(null);
  const head = cards.find((c) => c.kind === 'pace');
  const safe = cards.find((c) => c.kind === 'safe');
  const rest = cards.filter((c) => c.kind !== 'pace' && c.kind !== 'safe');
  if (!cards.length) return null;
  const scale =
    Math.max(pace.projectedMinor, pace.budgetMinor ?? 0, pace.lastMonthMinor, pace.spentMinor, 1) * 1.08;
  const over =
    pace.budgetMinor !== null
      ? pace.projectedMinor > pace.budgetMinor
      : pace.projectedMinor > pace.lastMonthMinor * 1.05;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const act = (c: Insight) => {
    const a = c.action;
    if (!a) return;
    if (a.kind === 'open-tx') onOpenTx(a.txId);
    else if (a.kind === 'open-merchant') setMerchant(a.merchant);
    else if (a.kind === 'categorise') setFiling(true);
    else if (a.kind === 'review-duplicates') setDupes(a.txIds);
    else if (a.kind === 'track-recurring') {
      const last = transactions
        .filter((t) => merchantKey(t.merchant) === merchantKey(a.merchant))
        .sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))[0];
      onTrack({
        merchant: a.merchant,
        amountMinor: a.amountMinor,
        day: last ? new Date(last.occurredAt).getDate() : 1,
        categoryId: last?.categoryId ?? null,
      });
    }
  };
  return (
    <section className="flex flex-col gap-3" aria-label="Insights">
      {head || safe ? (
        <Glass className="flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2">
            {over ? (
              <TrendingUp size={17} className="mt-0.5 text-orv-warning" aria-hidden />
            ) : (
              <Gauge size={17} className="mt-0.5 text-orv-success" aria-hidden />
            )}
            <div>
              <p className="text-[15px] font-bold">{head?.title ?? 'This month'}</p>
              {head?.body ? <p className="text-[12.5px] text-orv-muted">{head.body}</p> : null}
            </div>
          </div>
          <div
            className="relative h-3 rounded-full bg-orv-track"
            role="img"
            aria-label={`Spent ${formatMoney(pace.spentMinor)}, heading for ${formatMoney(pace.projectedMinor)}`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: pct(pace.projectedMinor),
                background: `color-mix(in srgb, ${over ? 'var(--orv-warning)' : 'var(--orv-success)'} 28%, transparent)`,
              }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full [background:var(--orv-accent-grad)]"
              style={{ width: pct(pace.spentMinor) }}
            />
            {pace.budgetMinor !== null ? (
              <div
                className="absolute -inset-y-1 w-0.5 bg-orv-text/70"
                style={{ left: pct(pace.budgetMinor) }}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-orv-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm [background:var(--orv-accent-grad)]" /> Spent{' '}
              {formatMoney(pace.spentMinor)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-[color-mix(in_srgb,var(--orv-success)_45%,transparent)]" />{' '}
              Heading for {formatMoney(pace.projectedMinor)}
            </span>
            {pace.budgetMinor !== null ? (
              <span className="ml-auto">Budget {formatMoney(pace.budgetMinor)}</span>
            ) : null}
          </div>
          {safe ? (
            <p
              className={cn(
                'flex items-center gap-2 rounded-orv-md px-3 py-2 text-[13.5px] font-semibold',
                pace.safePerDayMinor === 0
                  ? 'bg-[color-mix(in_srgb,var(--orv-danger)_10%,transparent)]'
                  : 'bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)]',
              )}
            >
              <ShieldCheck
                size={16}
                className={pace.safePerDayMinor === 0 ? 'text-orv-danger' : 'text-orv-accent'}
                aria-hidden
              />
              {safe.title}
            </p>
          ) : null}
        </Glass>
      ) : null}
      {rest.length ? (
        <>
          <span className="flex items-center gap-1.5 px-1">
            <Sparkles size={14} className="text-orv-accent" aria-hidden />
            <Label>Worth a look · {rest.length}</Label>
          </span>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => act(c)}
                disabled={!c.action}
                className="glass-pane flex items-start gap-3 p-3.5 text-left transition-transform hover:-translate-y-0.5 disabled:hover:translate-y-0"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full"
                  style={{
                    color: TONE[c.tone],
                    background: `color-mix(in srgb, ${TONE[c.tone]} 14%, transparent)`,
                  }}
                  aria-hidden
                >
                  {ICON[c.kind] ?? <Sparkles size={16} />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-bold leading-snug">{c.title}</span>
                  <span className="text-[12px] text-orv-muted">{c.body}</span>
                  {c.action ? (
                    <span className="mt-1 text-[12px] font-bold" style={{ color: TONE[c.tone] }}>
                      {CTA[c.action.kind]}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <MerchantSheet merchant={merchant} onClose={() => setMerchant(null)} />
      <QuickFileSheet open={filing} onClose={() => setFiling(false)} />
      <DuplicatesSheet ids={dupes} onClose={() => setDupes(null)} />
    </section>
  );
}

// ------------------------------------------------------------------ merchant

export function MerchantSheet({ merchant, onClose }: { merchant: string | null; onClose(): void }) {
  const profiles = useProfiles();
  const { transactions, categories, updateTransaction } = useMoney();
  const toast = useToast();
  const { ask, picker } = usePick();
  const [renaming, setRenaming] = useState<string | null>(null);
  const p = merchant ? profiles.get(merchantKey(merchant)) : undefined;
  const txs = p
    ? transactions
        .filter((t) => merchantKey(t.merchant) === p.key && !t.transfer)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    : [];
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const tz = zone();
  const per = months.map((m) =>
    txs.filter((t) => monthOf(t.occurredAt, tz) === m).reduce((a, t) => a + t.amountMinor, 0),
  );
  const top = Math.max(1, ...per);
  const cat = categories.find((c) => c.id === p?.categoryId);
  const year = txs
    .filter((t) => new Date(t.occurredAt).getFullYear() === now.getFullYear())
    .reduce((a, t) => a + t.amountMinor, 0);
  return (
    <Sheet
      open={!!merchant}
      onClose={onClose}
      title={p?.merchant ?? merchant ?? ''}
      subtitle={
        p
          ? cat
            ? `Usually ${cat.name} · ${Math.round(p.categoryShare * 100)}%`
            : 'Not filed yet'
          : undefined
      }
      footer={
        p ? (
          <>
            <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setRenaming(p.merchant)}>
              <Pencil size={14} /> Rename everywhere
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const v = await ask<string>(
                  `File all ${p.count} as`,
                  categories
                    .filter(
                      (c) => !c.archived && c.kind === (p.direction === 'credit' ? 'income' : 'expense'),
                    )
                    .map((c) => ({
                      value: c.id,
                      label: c.name,
                      colour: colour(c),
                      selected: c.id === p.categoryId,
                    })),
                );
                if (!v) return;
                const todo = txs.filter((t) => t.categoryId !== v);
                for (const t of todo) await updateTransaction(t.id, { categoryId: v, reviewed: true });
                toast({
                  title: todo.length ? `Filed ${todo.length} payments` : 'Already filed that way',
                  body: `New ones from ${p.merchant} will be filed the same way.`,
                  tone: 'success',
                });
              }}
            >
              <Tags size={14} /> File all as…
            </Button>
          </>
        ) : null
      }
    >
      {!p ? (
        <p className="text-small text-orv-muted">No payments here yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              [formatMoney(year), 'this year'],
              [String(p.count), 'payments'],
              [formatMoney(p.medianMinor), 'usually'],
            ].map(([v, k]) => (
              <div key={k}>
                <p className="tabular text-heading font-semibold">{v}</p>
                <p className="text-[11.5px] text-orv-muted">{k}</p>
              </div>
            ))}
          </div>
          <div>
            <Label>Last 6 months</Label>
            <div className="mt-2 flex h-28 items-end gap-2">
              {months.map((m, i) => (
                <div key={m} className="flex flex-1 flex-col items-center gap-1">
                  <span className="tabular text-[10px] text-orv-muted">
                    {per[i] ? formatMoney(per[i]!) : ''}
                  </span>
                  <div
                    className={cn(
                      'w-full rounded-md transition-[height] duration-500',
                      i === 5
                        ? '[background:var(--orv-accent-grad)]'
                        : 'bg-[color-mix(in_srgb,var(--orv-accent)_35%,transparent)]',
                    )}
                    style={{ height: `${Math.max(4, (per[i]! / top) * 64)}px` }}
                  />
                  <span className="text-[10.5px] text-orv-muted">
                    {new Date(`${m}-01T12:00`).toLocaleDateString(undefined, { month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label>Recent</Label>
            <ul className="mt-1 flex flex-col">
              {txs.slice(0, 8).map((t) => (
                <li key={t.id} className="flex justify-between py-1.5 text-[13px]">
                  <span className="text-orv-muted">
                    {new Date(t.occurredAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    · {categories.find((c) => c.id === t.categoryId)?.name ?? 'Uncategorised'}
                  </span>
                  <span
                    className={cn(
                      'tabular font-semibold',
                      t.amountMinor > p.medianMinor * 2.5 && 'text-orv-warning',
                    )}
                  >
                    {formatMoney(t.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {picker}
      <Sheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={`Rename ${p?.merchant ?? ''}`}
        subtitle="Every payment gets this name — handy to merge “AMZN MKTP” into Amazon."
        footer={
          <Button
            variant="primary"
            disabled={!renaming?.trim()}
            onClick={async () => {
              const name = renaming!.trim();
              for (const t of txs) await updateTransaction(t.id, { merchant: name });
              toast({ title: `Renamed ${txs.length} payments`, body: name, tone: 'success' });
              setRenaming(null);
              onClose();
            }}
          >
            Rename {txs.length}
          </Button>
        }
      >
        <Input
          aria-label="New name"
          value={renaming ?? ''}
          onChange={(e) => setRenaming(e.target.value)}
          autoFocus
        />
      </Sheet>
    </Sheet>
  );
}

// ------------------------------------------------------------------ quick filing

function likelyCategories(
  t: Transaction,
  cats: Category[],
  profiles: Map<string, MerchantProfile>,
  used: Map<string, number>,
) {
  const want = t.direction === 'credit' ? 'income' : 'expense';
  const pool = cats.filter((c) => !c.archived && c.kind === want);
  const out: Category[] = [];
  const add = (c?: Category) => c && !out.includes(c) && out.push(c);
  add(pool.find((c) => c.id === profiles.get(merchantKey(t.merchant))?.categoryId));
  const guess = cleanMerchant(t.rawMerchant || t.merchant).category;
  add(pool.find((c) => c.slug === guess));
  for (const c of [...pool].sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0))) add(c);
  return out.slice(0, 4);
}

export function QuickFileSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { transactions, categories, updateTransaction } = useMoney();
  const profiles = useProfiles();
  const [done, setDone] = useState(0);
  const loose = transactions
    .filter((t) => !t.categoryId && !t.transfer)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const used = new Map<string, number>();
  for (const t of transactions) if (t.categoryId) used.set(t.categoryId, (used.get(t.categoryId) ?? 0) + 1);
  const file = async (t: Transaction, categoryId: string) => {
    const same = loose.filter(
      (x) => x.id === t.id || (t.merchant && merchantKey(x.merchant) === merchantKey(t.merchant)),
    );
    for (const x of same) await updateTransaction(x.id, { categoryId, reviewed: true });
    setDone((n) => n + same.length);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={loose.length ? `File ${loose.length}` : 'All filed'}
      subtitle="Tap a category — the same merchant is filed along with it."
      footer={
        <>
          <span className="mr-auto text-small text-orv-muted">{done ? `Filed ${done} so far.` : ''}</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {!loose.length ? (
        <p className="flex items-center gap-2 py-6 text-[15px]">
          <PartyPopper size={20} className="text-orv-accent" /> Every payment has a category.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {loose.slice(0, 30).map((t) => (
            <li key={t.id} className="glass-pane flex flex-col gap-2 p-3">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{t.merchant || 'Payment'}</span>
                <span className="tabular font-semibold">{formatMoney(t.amountMinor)}</span>
              </div>
              <span className="-mt-1.5 text-[12px] text-orv-muted">
                {new Date(t.occurredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {likelyCategories(t, categories, profiles, used).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void file(t, c.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-orv-edge px-3 text-[13px] hover:border-orv-accent"
                  >
                    <span className="size-2 rounded-full" style={{ background: colour(c) }} /> {c.name}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ double charges

export function DuplicatesSheet({ ids, onClose }: { ids: string[] | null; onClose(): void }) {
  const { transactions, removeTransaction } = useMoney();
  const toast = useToast();
  const list = transactions
    .filter((t) => ids?.includes(t.id))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return (
    <Sheet
      open={!!ids}
      onClose={onClose}
      title="Charged twice?"
      subtitle="Same amount, same place, minutes apart. If your bank shows only one payment, delete the extra."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Keep both
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {list.map((t) => (
          <li key={t.id} className="glass-pane flex items-center gap-3 p-3">
            <span className="flex flex-1 flex-col">
              <span className="font-semibold">
                {formatMoney(t.amountMinor)} · {t.merchant}
              </span>
              <span className="text-[12px] text-orv-muted">
                {new Date(t.occurredAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                · {t.source === 'manual' ? 'typed' : t.source}
              </span>
            </span>
            {list.length > 1 ? (
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await removeTransaction(t.id);
                  toast({ title: `Deleted the extra ${formatMoney(t.amountMinor)}` });
                  onClose();
                }}
              >
                <Trash2 size={14} /> Delete
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ------------------------------------------------------------------ smart fill (the add form)

/**
 * Under the merchant field: merchants you've paid that match what's typed — or, with only an amount, who you paid
 * that much before — and the usual amounts for the one you picked.
 */
export function SmartFill({
  merchant,
  amountMinor,
  why,
  onPick,
  onAmount,
}: {
  merchant: string;
  amountMinor: number | null;
  why: string | null;
  onPick(p: MerchantProfile): void;
  onAmount(minor: number): void;
}) {
  const profiles = useProfiles();
  const { categories } = useMoney();
  const exact = profiles.get(merchantKey(merchant));
  const typed = merchant.trim();
  const people = !typed
    ? amountMinor
      ? merchantsForAmount(profiles, amountMinor)
      : suggestMerchants(profiles, '', Date.now(), 4)
    : exact
      ? []
      : suggestMerchants(profiles, typed, Date.now(), 4);
  const amounts = exact ? exact.amounts.filter((a) => a !== amountMinor).slice(0, 3) : [];
  if (!people.length && !amounts.length && !why) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {people.length ? (
        <>
          <span className="text-[11.5px] font-semibold text-orv-muted">
            {!typed && amountMinor
              ? `You paid ${formatMoney(amountMinor)} to`
              : !typed
                ? 'Often'
                : 'From your history'}
          </span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {people.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPick(p)}
                className="flex shrink-0 flex-col items-start rounded-orv-md border border-[color-mix(in_srgb,var(--orv-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--orv-accent)_8%,transparent)] px-2.5 py-1.5 text-left hover:border-orv-accent"
              >
                <span className="text-[13px] font-bold">{p.merchant}</span>
                <span className="text-[11px] text-orv-muted">
                  {[
                    `~${formatMoney(p.medianMinor)}`,
                    categories.find((c) => c.id === p.categoryId)?.name,
                    `${p.count}×`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {amounts.length ? (
        <div className="flex flex-wrap gap-1.5">
          {amounts.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onAmount(a)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-orv-edge px-2.5 text-[12.5px] hover:border-orv-accent"
            >
              <History size={12} className="text-orv-accent" aria-hidden /> {formatMoney(a)}
            </button>
          ))}
        </div>
      ) : null}
      {why ? (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-orv-accent">
          <Sparkles size={12} aria-hidden /> {why}
        </span>
      ) : null}
    </div>
  );
}
