'use client';

import { type Category, formatMoney, type Transaction } from '@orvyn/contracts';
import {
  budgetProgress,
  monthOf,
  monthStory,
  parseSpend,
  parseStatement,
  prevMonth,
  subscriptions,
  summarise,
} from '@orvyn/money';
import {
  ArrowLeftRight,
  BadgePercent,
  Briefcase,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clapperboard,
  FileUp,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  type LucideIcon,
  Plane,
  Plus,
  PlusCircle,
  Receipt,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Trash2,
  TrendingUp,
  Undo2,
  Utensils,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useMoney } from '@/lib/money';

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  'shopping-basket': ShoppingBasket,
  car: Car,
  fuel: Fuel,
  'shopping-bag': ShoppingBag,
  receipt: Receipt,
  house: House,
  'heart-pulse': HeartPulse,
  clapperboard: Clapperboard,
  repeat: Repeat,
  plane: Plane,
  'graduation-cap': GraduationCap,
  sparkles: Sparkles,
  gift: Gift,
  'trending-up': TrendingUp,
  'badge-percent': BadgePercent,
  circle: Circle,
  briefcase: Briefcase,
  'undo-2': Undo2,
  'plus-circle': PlusCircle,
  'arrow-left-right': ArrowLeftRight,
};
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const label = (c?: Category | null) => `var(--orv-label-${c?.colour ?? 'slate'})`;
const monthName = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export default function MoneyPage() {
  return (
    <div data-module="money">
      <MoneyView />
    </div>
  );
}

function MoneyView() {
  const { ready, transactions, categories, budgets, updateTransaction } = useMoney();
  const tz = zone();
  const [month, setMonth] = useState(() => monthOf(new Date().toISOString(), tz));
  const [editing, setEditing] = useState<Transaction | null>(null);
  const cat = (id: string | null) => categories.find((c) => c.id === id);
  const s = useMemo(() => summarise(transactions, month, tz), [transactions, month, tz]);
  const story = useMemo(() => monthStory(transactions, month, tz), [transactions, month, tz]);
  const subs = useMemo(() => subscriptions(transactions, month, tz), [transactions, month, tz]);
  const progress = useMemo(() => budgetProgress(budgets, s), [budgets, s]);
  const fresh = transactions.filter((t) => !t.reviewed);
  const inMonth = transactions.filter((t) => monthOf(t.occurredAt, tz) === month);
  const thisMonth = monthOf(new Date().toISOString(), tz);
  const next = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">{monthName(month)}</span>
          <h1 className="text-title font-semibold">Money</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setMonth(prevMonth(month))}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            size="sm"
            variant={month === thisMonth ? 'secondary' : 'ghost'}
            onClick={() => setMonth(thisMonth)}
          >
            This month
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next month"
            disabled={month >= thisMonth}
            onClick={() => setMonth(next(month))}
          >
            <ChevronRight size={16} />
          </Button>
          <ImportStatement />
        </div>
      </header>

      <QuickEntry />

      {fresh.length ? (
        <Glass className="flex flex-col gap-2 p-4" aria-label="New">
          <div className="flex items-center justify-between">
            <Label>New · {fresh.length}</Label>
            <Button size="sm" variant="ghost" onClick={() => void markAll(fresh)}>
              <Check size={14} /> All fine
            </Button>
          </div>
          <TxList items={fresh.slice(0, 8)} cat={cat} onOpen={setEditing} fresh />
        </Glass>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Glass className="p-5">
          <Label>Spent</Label>
          <p className="text-display font-semibold tabular-nums" aria-label="Spent this month">
            {formatMoney(s.spentMinor)}
          </p>
          <p className="text-small text-orv-muted">
            {story.deltaMinor === 0
              ? 'Same as last month'
              : `${formatMoney(Math.abs(story.deltaMinor))} ${story.deltaMinor > 0 ? 'more' : 'less'} than ${monthName(prevMonth(month)).split(' ')[0]}`}
          </p>
        </Glass>
        <Glass className="p-5">
          <Label>Came in</Label>
          <p className="text-display font-semibold tabular-nums">{formatMoney(s.earnedMinor)}</p>
          <p className="text-small text-orv-muted">Transfers between your accounts aren’t counted</p>
        </Glass>
        <Glass className="flex flex-col gap-2 p-5" aria-label="Budgets">
          <Label>Budgets</Label>
          {progress.length ? (
            progress.slice(0, 4).map((b) => (
              <div key={b.budgetId}>
                <div className="flex justify-between text-[13px]">
                  <span>{b.categoryId ? (cat(b.categoryId)?.name ?? 'Category') : 'Everything'}</span>
                  <span className={cn('tabular-nums', b.ratio > 1 && 'text-orv-danger')}>
                    {formatMoney(b.usedMinor)} / {formatMoney(b.limitMinor)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-orv-track">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, b.ratio * 100)}%`,
                      background:
                        b.ratio > 1
                          ? 'var(--orv-danger)'
                          : b.ratio > 0.8
                            ? 'var(--orv-warning)'
                            : 'var(--orv-accent-grad)',
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-small text-orv-muted">None yet. Set them below.</p>
          )}
        </Glass>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Glass className="flex flex-col gap-3 p-4" aria-label="Transactions">
          <Label>{monthName(month)}</Label>
          {!ready ? (
            <div className="skeleton h-24 rounded-orv-md" />
          ) : inMonth.length ? (
            <TxList items={inMonth} cat={cat} onOpen={setEditing} />
          ) : (
            <p className="text-small text-orv-muted">
              Nothing yet. Type above (“spent 240 on lunch”), drop a receipt, import a statement — or let your
              phone read bank and UPI messages.
            </p>
          )}
        </Glass>

        <div className="flex flex-col gap-3">
          <Glass className="flex flex-col gap-2 p-4" aria-label="By category">
            <Label>By category</Label>
            {s.byCategory.map((b) => {
              const c = cat(b.categoryId);
              const Icon = ICONS[c?.icon ?? 'circle'] ?? Circle;
              return (
                <div key={b.categoryId ?? 'none'} className="flex items-center gap-2 text-[13px]">
                  <Icon size={14} style={{ color: label(c) }} aria-hidden />
                  <span className="flex-1 truncate">{c?.name ?? 'Uncategorised'}</span>
                  <span className="tabular-nums text-orv-muted">{formatMoney(b.spentMinor)}</span>
                </div>
              );
            })}
            {!s.byCategory.length ? (
              <p className="text-small text-orv-muted">No spending this month.</p>
            ) : null}
          </Glass>
          {story.moves.length ? (
            <Glass className="flex flex-col gap-1 p-4" aria-label="What changed">
              <Label>What changed</Label>
              {story.moves.slice(0, 4).map((m) => (
                <p key={m.categoryId ?? 'none'} className="text-[13px]">
                  <span className="font-medium">{cat(m.categoryId)?.name ?? 'Uncategorised'}</span>{' '}
                  <span className={m.deltaMinor > 0 ? 'text-orv-danger' : 'text-orv-success'}>
                    {m.deltaMinor > 0 ? '+' : '−'}
                    {formatMoney(Math.abs(m.deltaMinor))}
                  </span>{' '}
                  <span className="text-orv-muted">vs last month</span>
                </p>
              ))}
            </Glass>
          ) : null}
          {subs.length ? (
            <Glass className="flex flex-col gap-1 p-4" aria-label="Subscriptions">
              <Label>Subscriptions · {formatMoney(subs.reduce((a, x) => a + x.amountMinor, 0))}/month</Label>
              {subs.map((x) => (
                <div key={x.merchant} className="flex justify-between text-[13px]">
                  <span>{x.merchant}</span>
                  <span className="tabular-nums text-orv-muted">{formatMoney(x.amountMinor)}</span>
                </div>
              ))}
            </Glass>
          ) : null}
          <Budgets />
        </div>
      </div>

      <TxSheet tx={editing} onClose={() => setEditing(null)} />
    </div>
  );

  async function markAll(list: Transaction[]) {
    for (const t of list) await updateTransaction(t.id, { reviewed: true });
  }
}

function TxList({
  items,
  cat,
  onOpen,
  fresh,
}: {
  items: Transaction[];
  cat(id: string | null): Category | undefined;
  onOpen(t: Transaction): void;
  fresh?: boolean;
}) {
  const money = useMoney();
  let lastDay = '';
  return (
    <ul
      className="flex flex-col"
      role="list"
      aria-label={fresh ? 'New transactions' : 'Transactions this month'}
    >
      {items.map((t) => {
        const c = cat(t.categoryId);
        const Icon = ICONS[c?.icon ?? 'circle'] ?? Circle;
        const day = new Date(t.occurredAt).toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
        const header = !fresh && day !== lastDay ? ((lastDay = day), day) : null;
        return (
          <li key={t.id}>
            {header ? (
              <p className="mt-2 px-1 text-[11px] font-semibold uppercase text-orv-faint">{header}</p>
            ) : null}
            <div className="flex items-center gap-3 rounded-orv-md px-1 py-2 hover:bg-orv-track">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: `color-mix(in srgb, ${label(c)} 16%, transparent)` }}
                aria-hidden
              >
                <Icon size={15} style={{ color: label(c) }} />
              </span>
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(t)}>
                <span className="block truncate text-[14px] font-medium">
                  {t.merchant || c?.name || 'Transaction'}
                </span>
                <span className="block truncate text-[12px] text-orv-muted">
                  {c?.name ?? 'Uncategorised'}
                  {t.transfer ? ' · transfer' : ''} · {t.source === 'manual' ? 'typed' : t.source}
                  {fresh ? ` · ${day}` : ''}
                </span>
              </button>
              <span
                className={cn(
                  'shrink-0 text-[14px] font-semibold tabular-nums',
                  t.direction === 'credit' && 'text-orv-success',
                )}
              >
                {t.direction === 'credit' ? '+' : ''}
                {formatMoney(t.amountMinor, t.currency)}
              </span>
              {fresh ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Looks right: ${t.merchant || 'transaction'}`}
                  onClick={() => void money.updateTransaction(t.id, { reviewed: true })}
                >
                  <Check size={14} />
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function QuickEntry() {
  const { addTransaction, categoryBySlug } = useMoney();
  const toast = useToast();
  const [text, setText] = useState('');
  const p = text.trim() ? parseSpend(text) : null;
  return (
    <Glass level="float" className="p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!p) return;
          void addTransaction({
            amountMinor: p.amountMinor,
            direction: p.direction,
            merchant: p.merchant,
            note: p.note,
            categoryId: categoryBySlug(p.category)?.id ?? null,
            occurredAt: new Date().toISOString(),
            source: 'manual',
          }).then(() => {
            toast({
              title: `${p.direction === 'credit' ? 'Received' : 'Spent'} ${formatMoney(p.amountMinor)}`,
              tone: 'success',
            });
            setText('');
          });
        }}
      >
        <Plus size={18} className="ml-1 shrink-0 text-orv-accent" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add… “spent 240 on lunch at swiggy”, “uber 180”, “got 500 from rahul”"
          aria-label="New transaction"
          maxLength={200}
          className="h-11 flex-1 bg-transparent text-[16px] outline-none placeholder:text-orv-faint"
        />
        {p ? (
          <Badge tone={p.direction === 'credit' ? 'success' : 'accent'}>
            {p.direction === 'credit' ? '+' : ''}
            {formatMoney(p.amountMinor)}
            {p.merchant ? ` · ${p.merchant}` : ''}
            {categoryBySlug(p.category) ? ` · ${categoryBySlug(p.category)!.name}` : ''}
          </Badge>
        ) : null}
        <Button type="submit" size="sm" variant="primary" disabled={!p}>
          Add
        </Button>
      </form>
    </Glass>
  );
}

function TxSheet({ tx, onClose }: { tx: Transaction | null; onClose(): void }) {
  const { categories, accounts, updateTransaction, removeTransaction } = useMoney();
  const toast = useToast();
  const [d, setD] = useState<Transaction | null>(tx);
  const [shown, setShown] = useState<string | null>(null);
  if (tx && shown !== tx.id) {
    setShown(tx.id);
    setD(tx);
  }
  if (!tx && shown) setShown(null);
  const save = async () => {
    if (!d) return;
    await updateTransaction(d.id, {
      amountMinor: d.amountMinor,
      direction: d.direction,
      merchant: d.merchant,
      categoryId: d.categoryId,
      accountId: d.accountId,
      note: d.note,
      transfer: d.transfer,
      occurredAt: d.occurredAt,
      reviewed: true,
    });
    onClose();
  };
  const local = (iso: string) => {
    const x = new Date(iso);
    return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  return (
    <Sheet open={!!tx} onClose={onClose} title="Transaction">
      {d ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex items-end gap-2">
            <Field label="Amount (₹)">
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={(d.amountMinor / 100).toString()}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value.replace(/,/g, '')) * 100);
                    if (Number.isFinite(v) && v > 0) setD({ ...d, amountMinor: v });
                  }}
                />
              )}
            </Field>
            <Segmented
              label="Direction"
              value={d.direction}
              onChange={(v) => setD({ ...d, direction: v as 'debit' | 'credit' })}
              options={[
                { value: 'debit', label: 'Spent' },
                { value: 'credit', label: 'Came in' },
              ]}
            />
          </div>
          <Field label="Merchant">
            {(id) => (
              <Input
                id={id}
                value={d.merchant}
                maxLength={120}
                onChange={(e) => setD({ ...d, merchant: e.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              {(id) => (
                <select
                  id={id}
                  value={d.categoryId ?? ''}
                  onChange={(e) => setD({ ...d, categoryId: e.target.value || null })}
                  className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
                >
                  <option value="">Uncategorised</option>
                  {categories
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Account">
              {(id) => (
                <select
                  id={id}
                  value={d.accountId ?? ''}
                  onChange={(e) => setD({ ...d, accountId: e.target.value || null })}
                  className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
                >
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.last4 ? ` ··${a.last4}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="When">
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={local(d.occurredAt)}
                onChange={(e) =>
                  e.target.value && setD({ ...d, occurredAt: new Date(e.target.value).toISOString() })
                }
              />
            )}
          </Field>
          <Field label="Note">
            {(id) => (
              <Input
                id={id}
                value={d.note}
                maxLength={2000}
                onChange={(e) => setD({ ...d, note: e.target.value })}
              />
            )}
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[14px]">Between my own accounts (not spending)</span>
            <Switch
              checked={d.transfer}
              onChange={(v) => setD({ ...d, transfer: v })}
              label="Transfer between my accounts"
            />
          </div>
          {d.rawMerchant && d.rawMerchant !== d.merchant ? (
            <p className="text-[12px] text-orv-faint">The message said: {d.rawMerchant}</p>
          ) : null}
          <div className="flex justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await removeTransaction(d.id);
                toast({ title: 'Deleted', body: d.merchant || formatMoney(d.amountMinor) });
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}

function Budgets() {
  const { budgets, categories, saveBudget, removeBudget } = useMoney();
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const thisMonth = monthOf(new Date().toISOString(), zone());
  const live = budgets.filter((b) => !b.archived);
  return (
    <Glass className="flex flex-col gap-2 p-4" aria-label="Set budgets">
      <Label>Monthly budgets</Label>
      {live.map((b) => (
        <div key={b.id} className="flex items-center gap-2 text-[13px]">
          <span className="flex-1">
            {b.categoryId ? (categories.find((c) => c.id === b.categoryId)?.name ?? '—') : 'Everything'}
          </span>
          <span className="tabular-nums">{formatMoney(b.amountMinor)}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove budget"
            onClick={() => void removeBudget(b.id)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Math.round(Number(amount.replace(/,/g, '')) * 100);
          if (!(v > 0)) return;
          const existing = live.find((b) => (b.categoryId ?? '') === categoryId);
          void saveBudget(existing?.id ?? null, {
            categoryId: categoryId || null,
            amountMinor: v,
            from: thisMonth,
          });
          setAmount('');
        }}
      >
        <select
          aria-label="Budget for"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-orv-md border border-orv-edge bg-orv-glass px-2 text-[13px]"
        >
          <option value="">Everything</option>
          {categories
            .filter((c) => c.kind === 'expense' && !c.archived)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <input
          aria-label="Budget amount"
          inputMode="decimal"
          placeholder="₹ a month"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-9 w-24 rounded-orv-md border border-orv-edge bg-orv-glass px-2 text-[13px]"
        />
        <Button size="sm" type="submit">
          Set
        </Button>
      </form>
    </Glass>
  );
}

function ImportStatement() {
  const { accounts, importStatement, saveAccount } = useMoney();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ReturnType<typeof parseStatement> | null>(null);
  const [accountId, setAccountId] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
        <FileUp size={14} /> Import statement
      </Button>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Statement file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const parsed = parseStatement(await f.text());
          if (!parsed.rows.length) toast({ title: 'No transactions found in that file', tone: 'danger' });
          else setRows(parsed);
        }}
      />
      <Sheet open={!!rows} onClose={() => setRows(null)} title="Import statement">
        {rows ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px]">
              {rows.rows.length} transactions found
              {rows.skipped ? ` (${rows.skipped} lines weren’t transactions)` : ''}. Ones you already have are
              skipped.
            </p>
            <Field label="Into account">
              {(id) => (
                <select
                  id={id}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
                >
                  <option value="">A new account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {!accountId ? (
              <Field label="Account name">
                {(id) => (
                  <Input
                    id={id}
                    value={newName}
                    placeholder="HDFC Savings"
                    onChange={(e) => setNewName(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRows(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!accountId && !newName.trim()}
                onClick={async () => {
                  setBusy(true);
                  const acct = accountId || (await saveAccount(null, { name: newName.trim(), kind: 'bank' }));
                  const r = await importStatement(rows.rows, acct);
                  setBusy(false);
                  setRows(null);
                  toast({
                    title: `Imported ${r.added}`,
                    body: r.skipped ? `${r.skipped} were already here` : undefined,
                    tone: 'success',
                  });
                }}
              >
                Import
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
