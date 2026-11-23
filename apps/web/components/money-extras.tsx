'use client';

import {
  type Account,
  type Category,
  formatMoney,
  PROJECT_COLOURS,
  type Recurring,
  type Transaction,
} from '@orvyn/contracts';
import { cleanMerchant, merchantKey, occurredAtFor } from '@orvyn/money';
import { SmartFill, useProfiles } from './money-brain';
import { describeSpec, nextDates, parseRepeat } from '@orvyn/today-plan';
import { Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RepeatBuilder } from '@/components/repeat-builder';
import { Badge, Label, Segmented, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useMoney } from '@/lib/money';

export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayOf = (d: Date, tz = zone()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
const shift = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const select =
  'h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px] text-orv-text';

/** What the person typed in the amount box, in paise (null while it isn't a positive amount). */
export const toMinor = (s: string): number | null => {
  const v = Math.round(Number(s.replace(/,/g, '').replace(/[₹\s]/g, '')) * 100);
  return Number.isFinite(v) && v > 0 ? v : null;
};

interface Draft {
  amount: string;
  direction: 'debit' | 'credit';
  merchant: string;
  categoryId: string;
  accountId: string;
  date: string;
  time: string;
  note: string;
  rrule: string;
  mode: 'add' | 'remind';
  /** what it was for — leads the row (spec 0014) */
  title?: string;
  /** between you and someone: '' just mine, 'lent' / 'borrowed' a new debt, 'settle:<iouId>' paying one off */
  between?: string;
  person?: string;
}

/**
 * The full "add" form: any day (chips for today / yesterday / the day before, or pick one), an optional time, and
 * "repeats" to make it a schedule (rent, subscription, salary) instead of a single entry. With `recurring` it edits
 * that schedule.
 */
export function AddTransactionSheet({
  open,
  onClose,
  seed,
  recurring,
}: {
  open: boolean;
  onClose(): void;
  seed?: Partial<Draft>;
  recurring?: Recurring | null;
}) {
  const { categories, accounts, addTransaction, saveRecurring, ious, saveIou } = useMoney();
  const toast = useToast();
  const tz = zone();
  const today = dayOf(new Date(), tz);
  const fresh = (): Draft =>
    recurring
      ? {
          amount: String(recurring.amountMinor / 100),
          direction: recurring.direction,
          merchant: recurring.merchant || recurring.title,
          categoryId: recurring.categoryId ?? '',
          accountId: recurring.accountId ?? '',
          date: recurring.startDate,
          time: recurring.time,
          note: recurring.note,
          rrule: recurring.rrule,
          mode: recurring.mode,
        }
      : {
          amount: '',
          direction: 'debit',
          merchant: '',
          categoryId: '',
          accountId: '',
          date: today,
          time: '',
          note: '',
          rrule: '',
          mode: 'add',
          ...seed,
        };
  const [d, setD] = useState<Draft>(fresh);
  const [problem, setProblem] = useState<string | null>(null);
  // smart fill (spec 0013): what the person picked themselves is left alone
  const profiles = useProfiles();
  const [touched, setTouched] = useState({ cat: false, acct: false });
  const [why, setWhy] = useState<string | null>(null);
  const fill = (merchant: string, extra: Partial<Draft> = {}) => {
    const p = profiles.get(merchantKey(merchant));
    const next: Partial<Draft> = { merchant, ...extra };
    if (!touched.cat) {
      if (p?.categoryId) {
        next.categoryId = p.categoryId;
        const times = Math.round(p.filed * p.categoryShare);
        setWhy(times <= 1 ? `Like last time at ${p.merchant}` : `Like your last ${times} at ${p.merchant}`);
      } else {
        const c = categories.find((c) => c.slug && c.slug === cleanMerchant(merchant).category);
        next.categoryId = c?.id ?? '';
        setWhy(c ? `Sounds like ${c.name}` : null);
      }
    }
    if (!touched.acct && p?.accountId) next.accountId = p.accountId;
    set(next);
  };
  useEffect(() => {
    if (open) {
      setD(fresh());
      setProblem(null);
      setTouched({ cat: !!recurring?.categoryId || !!seed?.categoryId, acct: !!recurring?.accountId });
      setWhy(null);
    }
  }, [open, recurring?.id]);
  const repeats = !!d.rrule;
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const chip = (label: string, day: string) => (
    <button
      type="button"
      aria-pressed={d.date === day}
      onClick={() => set({ date: day })}
      className={cn(
        'h-8 rounded-full border px-3 text-[13px] transition-colors',
        d.date === day
          ? 'border-transparent bg-orv-accent text-white'
          : 'border-orv-edge text-orv-muted hover:bg-orv-track',
      )}
    >
      {label}
    </button>
  );

  const submit = async () => {
    const amountMinor = toMinor(d.amount);
    if (!amountMinor) return setProblem('Enter an amount above zero.');
    if (!d.date) return setProblem('Pick a day.');
    if (!repeats && d.date > today)
      return setProblem('That day hasn’t happened yet. Turn on “Repeats” to schedule it.');
    const cat = d.categoryId || null;
    const acct = d.accountId || null;
    if (repeats) {
      await saveRecurring(recurring?.id ?? null, {
        title: d.merchant.trim() || categories.find((c) => c.id === cat)?.name || 'Scheduled',
        amountMinor,
        direction: d.direction,
        merchant: d.merchant.trim(),
        categoryId: cat,
        accountId: acct,
        note: d.note,
        rrule: d.rrule,
        startDate: d.date,
        time: d.time || '09:00',
        timeZone: tz,
        mode: d.mode,
        ...(recurring ? {} : { paused: false }),
      });
      toast({ title: 'Scheduled', body: describeSpec(parseRepeat(d.rrule)!), tone: 'success' });
    } else {
      const at = occurredAtFor({ date: d.date, time: d.time || null }, new Date(), tz);
      const between = d.between ?? '';
      let iouId: string | null = null;
      if (between === 'lent' || between === 'borrowed') {
        if (!d.person?.trim()) return setProblem('Who is it with?');
        iouId = await saveIou(null, {
          person: d.person.trim(),
          direction: between === 'lent' ? 'owed_to_me' : 'i_owe',
          amountMinor,
          note: d.title ?? '',
          startedAt: at.toISOString(),
        });
      } else if (between.startsWith('settle:')) {
        const debt = ious.find((x) => x.id === between.slice(7));
        if (debt) {
          const paid = Math.min(debt.amountMinor, debt.paidMinor + amountMinor);
          await saveIou(debt.id, {
            paidMinor: paid,
            ...(paid >= debt.amountMinor ? { settledAt: new Date().toISOString() } : {}),
          });
          iouId = debt.id;
        }
      }
      await addTransaction({
        amountMinor,
        direction: d.direction,
        title: (d.title ?? '').trim(),
        merchant: d.merchant.trim() || (iouId ? (d.person ?? '').trim() : ''),
        categoryId: iouId ? null : cat,
        accountId: acct,
        note: d.note,
        counted: !iouId,
        iouId,
        occurredAt: at.toISOString(),
        source: 'manual',
      });
      toast({
        title: `${d.direction === 'credit' ? 'Received' : 'Spent'} ${formatMoney(amountMinor)}`,
        body:
          d.date === today
            ? undefined
            : new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        tone: 'success',
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={recurring ? 'Scheduled' : 'Add transaction'}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-tx-form" variant="primary">
            {repeats ? 'Save schedule' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        id="add-tx-form"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Field label="Amount (₹)">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                autoFocus
                value={d.amount}
                placeholder="0"
                onChange={(e) => set({ amount: e.target.value })}
              />
            )}
          </Field>
          <Segmented
            label="Direction"
            value={d.direction}
            onChange={(v) => set({ direction: v })}
            options={[
              { value: 'debit', label: 'Spent' },
              { value: 'credit', label: 'Came in' },
            ]}
          />
        </div>
        <Field label="What for">
          {(id) => (
            <Input
              id={id}
              value={d.title ?? ''}
              maxLength={120}
              placeholder="Dinner with Riya"
              onChange={(e) => set({ title: e.target.value })}
            />
          )}
        </Field>
        <Field label={d.direction === 'credit' ? 'From' : 'Paid to'}>
          {(id) => (
            <Input
              id={id}
              value={d.merchant}
              maxLength={120}
              placeholder={d.direction === 'credit' ? 'Who sent it' : 'Shop, person or app'}
              onChange={(e) => fill(e.target.value)}
            />
          )}
        </Field>
        {!repeats ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Between you and someone?">
              {(id) => (
                <select
                  id={id}
                  className={select}
                  value={d.between ?? ''}
                  onChange={(e) => set({ between: e.target.value })}
                >
                  <option value="">No, it’s just mine</option>
                  {d.direction === 'debit' ? (
                    <option value="lent">I lent it / paid for someone</option>
                  ) : (
                    <option value="borrowed">I borrowed it / holding it for someone</option>
                  )}
                  {ious
                    .filter(
                      (x) =>
                        !x.settledAt && x.direction === (d.direction === 'credit' ? 'owed_to_me' : 'i_owe'),
                    )
                    .map((x) => (
                      <option key={x.id} value={`settle:${x.id}`}>
                        {d.direction === 'credit' ? `${x.person} paying me back` : `Paying ${x.person} back`}{' '}
                        ({formatMoney(Math.max(0, x.amountMinor - x.paidMinor))} left)
                      </option>
                    ))}
                </select>
              )}
            </Field>
            {d.between === 'lent' || d.between === 'borrowed' ? (
              <Field label="Who">
                {(id) => (
                  <Input
                    id={id}
                    value={d.person ?? ''}
                    placeholder="Rahul"
                    onChange={(e) => set({ person: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
        <SmartFill
          merchant={d.merchant}
          amountMinor={toMinor(d.amount)}
          why={why}
          onPick={(p) =>
            fill(p.merchant, {
              direction: p.direction,
              ...(toMinor(d.amount) ? {} : { amount: String(p.medianMinor / 100) }),
            })
          }
          onAmount={(m) => set({ amount: String(m / 100) })}
        />
        <div className="flex flex-col gap-2">
          <Label>{repeats ? 'Starts' : 'When'}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {!repeats ? (
              <>
                {chip('Today', today)}
                {chip('Yesterday', shift(today, -1))}
                {chip(
                  new Date(Date.parse(`${shift(today, -2)}T12:00:00Z`)).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  }),
                  shift(today, -2),
                )}
              </>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Day">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={d.date}
                  max={repeats ? undefined : today}
                  onChange={(e) => e.target.value && set({ date: e.target.value })}
                />
              )}
            </Field>
            <Field label={repeats ? 'Time' : 'Time (optional)'}>
              {(id) => (
                <Input id={id} type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} />
              )}
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            {(id) => (
              <select
                id={id}
                className={select}
                value={d.categoryId}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, cat: true }));
                  setWhy(null);
                  set({ categoryId: e.target.value });
                }}
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
                className={select}
                value={d.accountId}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, acct: true }));
                  set({ accountId: e.target.value });
                }}
              >
                <option value="">—</option>
                {accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.last4 ? ` ··${a.last4}` : ''}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Note">
          {(id) => (
            <Input id={id} value={d.note} maxLength={2000} onChange={(e) => set({ note: e.target.value })} />
          )}
        </Field>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px]">
            <Repeat size={15} aria-hidden /> Repeats
          </span>
          <Switch
            checked={repeats}
            label="Repeats"
            onChange={(v) => {
              if (!v) set({ rrule: '' });
              else set({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=' + Number(d.date.slice(8, 10)) });
            }}
          />
        </div>
        {repeats ? (
          <>
            <RepeatBuilder
              value={d.rrule}
              onChange={(r) => set({ rrule: r })}
              startDate={d.date}
              timeZone={zone()}
              allowNone={false}
            />
            <Segmented
              label="What happens"
              value={d.mode}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: 'add', label: 'Add it for me' },
                { value: 'remind', label: 'Just remind me' },
              ]}
            />
            <p className="text-[12px] text-orv-faint">
              {d.mode === 'add'
                ? 'Each time it’s due it appears under “New”, so you can fix the amount if it changed.'
                : 'You get a reminder on the day and add the real amount yourself.'}
            </p>
          </>
        ) : null}
        {problem ? (
          <p role="alert" className="text-[13px] text-orv-danger">
            {problem}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

type Tab = 'repeating' | 'accounts' | 'categories' | 'learned';

/** Everything about how Money is set up: scheduled entries, accounts and categories. */
export function ManageSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('repeating');
  return (
    <Sheet open={open} onClose={onClose} title="Manage money">
      <div className="flex flex-col gap-4">
        <Segmented
          label="Manage"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'repeating', label: 'Repeating' },
            { value: 'accounts', label: 'Accounts' },
            { value: 'categories', label: 'Categories' },
            { value: 'learned', label: 'Learned' },
          ]}
        />
        {tab === 'repeating' ? (
          <RepeatingList />
        ) : tab === 'accounts' ? (
          <Accounts />
        ) : tab === 'categories' ? (
          <Categories />
        ) : (
          <Learned />
        )}
      </div>
    </Sheet>
  );
}

interface MerchantRule {
  id: string;
  merchant: string;
  action: 'category' | 'transfer' | 'ignore';
  category: string | null;
  hits: number;
  always: boolean;
  active: boolean;
}

/** What ORVYN learned from answers to "what was it?" (spec 0007 C1): each merchant's rule, removable. */
function Learned() {
  const [rules, setRules] = useState<MerchantRule[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    api<MerchantRule[]>('/money/rules')
      .then(setRules)
      .catch(() => setRules([]));
  }, []);
  if (!rules) return <SkeletonRows rows={3} label="Loading what ORVYN learned" />;
  if (!rules.length)
    return (
      <p className="text-small text-orv-muted">
        Nothing yet. When ORVYN asks about a payment, answer with a category — say “always food” and that
        merchant is filed by itself from then on. Answering the same way twice does it too.
      </p>
    );
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Learned">
      {rules.map((r) => (
        <li key={r.id} className="glass-pane flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{r.merchant}</p>
            <p className="text-[12px] text-orv-muted">
              {r.action === 'ignore'
                ? 'Skipped — not yours'
                : r.action === 'transfer'
                  ? 'Your own transfer'
                  : `Filed as ${r.category ?? 'a deleted category'}`}
              {' · '}
              {r.active ? (r.always ? 'always' : `automatic (answered ${r.hits}×)`) : 'asks once more first'}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Forget ${r.merchant}`}
            onClick={async () => {
              await api(`/money/rules/${r.id}`, { method: 'DELETE' });
              setRules((xs) => xs?.filter((x) => x.id !== r.id) ?? null);
              toast({ title: `ORVYN will ask about ${r.merchant} again` });
            }}
          >
            Forget
          </Button>
        </li>
      ))}
    </ul>
  );
}

function RepeatingList() {
  const { recurring, saveRecurring, removeRecurring, categories } = useMoney();
  const [edit, setEdit] = useState<Recurring | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-2" aria-label="Repeating">
      {recurring.length ? (
        recurring.map((r) => {
          const spec = parseRepeat(r.rrule);
          const today = dayOf(new Date(), r.timeZone);
          const nxt = r.paused
            ? []
            : nextDates(
                r.rrule,
                r.startDate,
                1,
                r.timeZone,
                r.lastRunOn && r.lastRunOn >= today ? r.lastRunOn : today,
              );
          return (
            <div key={r.id} className="flex items-center gap-2 rounded-orv-md border border-orv-edge p-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(r)}>
                <span className="block truncate text-[14px] font-medium">{r.title}</span>
                <span className="block truncate text-[12px] text-orv-muted">
                  {formatMoney(r.amountMinor, r.currency)} · {spec ? describeSpec(spec) : 'custom'}
                  {nxt[0] ? ` · next ${nxt[0]}` : ''}
                  {categories.find((c) => c.id === r.categoryId)
                    ? ` · ${categories.find((c) => c.id === r.categoryId)!.name}`
                    : ''}
                </span>
              </button>
              {r.paused ? (
                <Badge tone="warning">Paused</Badge>
              ) : r.mode === 'remind' ? (
                <Badge>Reminder</Badge>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label={r.paused ? `Resume ${r.title}` : `Pause ${r.title}`}
                onClick={() => void saveRecurring(r.id, { paused: !r.paused })}
              >
                {r.paused ? <Play size={14} /> : <Pause size={14} />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${r.title}`}
                onClick={() => {
                  void removeRecurring(r.id);
                  toast({ title: 'Schedule removed', body: 'Entries already added stay.' });
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          );
        })
      ) : (
        <p className="text-small text-orv-muted">
          Nothing repeats yet. Add rent, a subscription or your salary once and it shows up on its day.
        </p>
      )}
      <Button variant="secondary" onClick={() => setAdding(true)}>
        <Plus size={14} /> New repeating entry
      </Button>
      <AddTransactionSheet
        open={adding || !!edit}
        recurring={edit}
        seed={{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' }}
        onClose={() => {
          setAdding(false);
          setEdit(null);
        }}
      />
    </div>
  );
}

const ACCOUNT_KINDS: Account['kind'][] = ['bank', 'card', 'upi', 'wallet', 'cash', 'loan'];
const KIND_LABEL: Record<Account['kind'], string> = {
  bank: 'Bank',
  card: 'Card',
  upi: 'UPI app',
  wallet: 'Wallet',
  cash: 'Cash',
  loan: 'Loan',
};

function Accounts() {
  const { accounts, saveAccount } = useMoney();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Account['kind']>('bank');
  const [last4, setLast4] = useState('');
  const live = accounts.filter((a) => !a.archived);
  return (
    <div className="flex flex-col gap-2" aria-label="Accounts">
      {live.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-orv-md border border-orv-edge p-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{a.name}</span>
            <span className="text-[12px] text-orv-muted">
              {KIND_LABEL[a.kind]}
              {a.last4 ? ` ··${a.last4}` : ''}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Archive ${a.name}`}
            onClick={() => void saveAccount(a.id, { archived: true })}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      {!live.length ? (
        <p className="text-small text-orv-muted">
          No accounts yet. They’re also created when a bank message is read.
        </p>
      ) : null}
      <form
        className="grid grid-cols-[1fr_auto] gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void saveAccount(null, {
            name: name.trim(),
            kind,
            last4: /^\d{3,6}$/.test(last4) ? last4 : null,
          }).then(() => {
            setName('');
            setLast4('');
          });
        }}
      >
        <Input
          aria-label="Account name"
          placeholder="New account (HDFC savings, Cash…)"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
        <select
          aria-label="Kind"
          className={select}
          value={kind}
          onChange={(e) => setKind(e.target.value as Account['kind'])}
        >
          {ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <Input
          aria-label="Last digits"
          placeholder="Last 4"
          inputMode="numeric"
          className="w-28"
          value={last4}
          maxLength={6}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
        />
      </form>
    </div>
  );
}

function Categories() {
  const { categories, saveCategory } = useMoney();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Category['kind']>('expense');
  const [colour, setColour] = useState<Category['colour']>('sky');
  const live = categories.filter((c) => !c.archived);
  return (
    <div className="flex flex-col gap-2" aria-label="Categories">
      {live.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-orv-md border border-orv-edge px-3 py-2">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ background: `var(--orv-label-${c.colour})` }}
            aria-hidden
          />
          <input
            aria-label={`Rename ${c.name}`}
            defaultValue={c.name}
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== c.name) void saveCategory(c.id, { name: v });
              else e.target.value = c.name;
            }}
          />
          <span className="text-[12px] text-orv-faint">
            {c.kind === 'income' ? 'income' : c.kind === 'transfer' ? 'transfer' : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Archive ${c.name}`}
            onClick={() => void saveCategory(c.id, { archived: true })}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <form
        className="flex flex-wrap items-center gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void saveCategory(null, { name: name.trim(), kind, colour, order: categories.length + 1 }).then(
            () => setName(''),
          );
        }}
      >
        <Input
          aria-label="Category name"
          className="min-w-40 flex-1"
          placeholder="New category (Pets, Hobbies…)"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="Category kind"
          className={cn(select, 'w-auto')}
          value={kind}
          onChange={(e) => setKind(e.target.value as Category['kind'])}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select
          aria-label="Colour"
          className={cn(select, 'w-auto')}
          value={colour}
          onChange={(e) => setColour(e.target.value as Category['colour'])}
        >
          {PROJECT_COLOURS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      <p className="text-[12px] text-orv-faint">
        Archiving hides a category from the lists; past entries keep it.
      </p>
    </div>
  );
}

const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must not run a note as a formula
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Transactions as a spreadsheet file (CSV) with day, amount, category, account and note. */
export function transactionsCsv(
  list: Transaction[],
  categories: Category[],
  accounts: Account[],
  tz: string,
): string {
  const rows = [
    [
      'Date',
      'Time',
      'Type',
      'Amount',
      'Currency',
      'Merchant',
      'Category',
      'Account',
      'Note',
      'Transfer',
      'Source',
    ],
  ];
  for (const t of [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const at = new Date(t.occurredAt);
    rows.push([
      dayOf(at, tz),
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(at),
      t.direction === 'credit' ? 'Came in' : 'Spent',
      (t.amountMinor / 100).toFixed(2),
      t.currency,
      t.merchant,
      categories.find((c) => c.id === t.categoryId)?.name ?? '',
      accounts.find((a) => a.id === t.accountId)?.name ?? '',
      t.note,
      t.transfer ? 'yes' : '',
      t.source,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
