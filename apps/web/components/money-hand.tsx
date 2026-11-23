'use client';

/**
 * What's in my hand and who owes whom (spec 0014): the money that is really yours right now — accounts minus card
 * and loan dues, minus what you owe, plus what will surely come back — and every open debt with a person.
 */
import { type Account, formatMoney, type Iou } from '@orvyn/contracts';
import { hand, peopleBalances } from '@orvyn/money';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  CreditCard,
  HandCoins,
  Landmark,
  Plus,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Glass, Label, Segmented, Sheet, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useMoney } from '@/lib/money';
import { useTodayMaybe } from '@/lib/today';

const OWED = ['card', 'loan'];
const toMinor = (s: string) => {
  const n = Number(s.replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const rupees = (m: number) => (m % 100 === 0 ? String(m / 100) : (m / 100).toFixed(2));
export const accountIcon = (kind: string) =>
  kind === 'card'
    ? CreditCard
    : kind === 'cash'
      ? Banknote
      : kind === 'wallet'
        ? Wallet
        : kind === 'upi'
          ? Smartphone
          : kind === 'loan'
            ? HandCoins
            : Landmark;

/** The hand: one number, what it's made of on a tap. */
export function HandCard() {
  const { accounts, transactions, ious } = useMoney();
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState(false);
  const h = useMemo(
    () =>
      hand(
        accounts.map((a) => ({ ...a, balanceMinor: a.balanceMinor ?? null, balanceAt: a.balanceAt ?? null })),
        transactions,
        ious,
      ),
    [accounts, transactions, ious],
  );
  const known = h.accounts.some((a) => a.nowMinor !== null) || ious.some((d) => !d.settledAt);
  const neg = h.inHandMinor < 0;
  return (
    <Glass className="flex flex-col gap-1 p-5" aria-label="In your hand">
      <div className="flex items-center justify-between">
        <Label>In your hand</Label>
        <button className="text-[12px] font-semibold text-orv-accent" onClick={() => setBalances(true)}>
          Balances
        </button>
      </div>
      {known ? (
        <>
          <button
            className="text-left"
            aria-expanded={open}
            aria-label={`In your hand: ${formatMoney(h.inHandMinor)}`}
            onClick={() => setOpen(!open)}
          >
            <p className={cn('text-display font-semibold tabular-nums', neg && 'text-orv-danger')}>
              {neg ? '−' : ''}
              {formatMoney(Math.abs(h.inHandMinor))}
            </p>
            <p className="flex items-center gap-1 text-small text-orv-muted">
              {h.owedToMeSureMinor > 0
                ? `${formatMoney(h.inHandTodayMinor)} without what’s still to come`
                : neg
                  ? 'You owe more than you have right now'
                  : 'Yours, after every due'}
              <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
            </p>
          </button>
          {open ? (
            <div className="mt-2 flex flex-col gap-1 text-[13px]">
              <Line label="In your accounts" minor={h.cashMinor} tone="text-orv-success" />
              {h.duesMinor ? (
                <Line label="Card & loan dues" minor={-h.duesMinor} tone="text-orv-danger" />
              ) : null}
              {h.iOweMinor ? (
                <Line label="You owe people" minor={-h.iOweMinor} tone="text-orv-danger" />
              ) : null}
              {h.owedToMeSureMinor ? (
                <Line label="Surely coming back" minor={h.owedToMeSureMinor} tone="text-orv-success" />
              ) : null}
              {h.owedToMeMaybeMinor ? (
                <Line label="Maybe coming back (not counted)" minor={h.owedToMeMaybeMinor} muted />
              ) : null}
              {h.cardAvailableMinor ? (
                <Line label="Card limit left (not yours)" minor={h.cardAvailableMinor} muted />
              ) : null}
              {h.unknown.length ? (
                <p className="text-[12px] text-orv-faint">No balance yet: {h.unknown.join(', ')}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-small text-orv-muted">
            Tell ORVYN your balances and card dues once; payments keep them current.
          </p>
          <Button size="sm" variant="primary" className="self-start" onClick={() => setBalances(true)}>
            <Wallet size={14} /> Set up
          </Button>
        </div>
      )}
      <BalancesSheet open={balances} onClose={() => setBalances(false)} accountsNow={h.accounts} />
    </Glass>
  );
}

function Line({
  label,
  minor,
  tone,
  muted,
}: {
  label: string;
  minor: number;
  tone?: string;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex justify-between', muted && 'text-orv-faint')}>
      <span>{label}</span>
      <span className={cn('tabular-nums font-medium', tone)}>
        {minor < 0 ? '−' : ''}
        {formatMoney(Math.abs(minor))}
      </span>
    </div>
  );
}

function BalancesSheet({
  open,
  onClose,
  accountsNow,
}: {
  open: boolean;
  onClose(): void;
  accountsNow: ReturnType<typeof hand>['accounts'];
}) {
  const { accounts } = useMoney();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Balances"
      subtitle="Check them against your bank app now and then; payments move them in between."
      footer={
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add an account
        </Button>
      }
    >
      {editing ? (
        <AccountForm
          account={editing === 'new' ? null : editing}
          nowMinor={
            editing === 'new' ? null : (accountsNow.find((a) => a.id === editing.id)?.nowMinor ?? null)
          }
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {!accountsNow.length ? (
            <p className="text-small text-orv-muted">Add your bank accounts, cards, cash and loans.</p>
          ) : null}
          {[false, true].map((owed) =>
            accountsNow.some((a) => a.owed === owed) ? (
              <div key={String(owed)} className="flex flex-col gap-1">
                <Label>{owed ? 'What you owe on' : 'What you have'}</Label>
                {accountsNow
                  .filter((a) => a.owed === owed)
                  .map((a) => {
                    const Icon = accountIcon(a.kind);
                    return (
                      <button
                        key={a.id}
                        className="flex items-center gap-3 rounded-orv-md px-2 py-2 text-left hover:bg-orv-track"
                        onClick={() => setEditing(accounts.find((x) => x.id === a.id) ?? null)}
                      >
                        <Icon size={16} className="text-orv-muted" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{a.name}</span>
                          <span className="block text-[12px] text-orv-muted">
                            {a.nowMinor === null
                              ? 'Tap to set'
                              : [
                                  a.movedMinor
                                    ? `${a.movedMinor > 0 ? '+' : '−'}${formatMoney(Math.abs(a.movedMinor))} since you set it`
                                    : null,
                                  a.availableMinor !== null ? `${formatMoney(a.availableMinor)} left` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'Up to date'}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            a.nowMinor === null ? 'text-orv-faint' : owed && 'text-orv-danger',
                          )}
                        >
                          {a.nowMinor === null ? '—' : formatMoney(a.nowMinor)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : null,
          )}
        </div>
      )}
    </Sheet>
  );
}

const KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'upi', label: 'UPI' },
  { value: 'loan', label: 'Loan' },
] as const;

function AccountForm({
  account,
  nowMinor,
  onDone,
}: {
  account: Account | null;
  nowMinor: number | null;
  onDone(): void;
}) {
  const { saveAccount } = useMoney();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<string>(account?.kind ?? 'bank');
  const [bal, setBal] = useState(nowMinor === null ? '' : rupees(nowMinor));
  const [limit, setLimit] = useState(account?.creditLimitMinor ? rupees(account.creditLimitMinor) : '');
  const owed = OWED.includes(kind);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const b = bal.trim() === '0' ? 0 : toMinor(bal);
        const changed = b !== null && b !== nowMinor;
        await saveAccount(account?.id ?? null, {
          name: name.trim(),
          kind: kind as Account['kind'],
          ...(changed ? { balanceMinor: b, balanceAt: new Date().toISOString() } : {}),
          creditLimitMinor: kind === 'card' ? toMinor(limit) : null,
        });
        onDone();
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of account">
        {KINDS.map((k) => {
          const Icon = accountIcon(k.value);
          return (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px]',
                kind === k.value
                  ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] font-semibold text-orv-accent'
                  : 'border-orv-edge',
              )}
            >
              <Icon size={13} aria-hidden /> {k.label}
            </button>
          );
        })}
      </div>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={owed ? 'ICICI Amazon card' : 'HDFC savings'}
            autoFocus
          />
        )}
      </Field>
      <Field
        label={owed ? 'Owed on it right now (₹)' : 'In it right now (₹)'}
        hint="From now on, payments on this account move it."
      >
        {(id) => <Input id={id} inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} />}
      </Field>
      {kind === 'card' ? (
        <Field label="Credit limit (₹, optional)">
          {(id) => (
            <Input id={id} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          )}
        </Field>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" variant="primary">
          Save account
        </Button>
      </div>
    </form>
  );
}

/** Who owes whom: net per person, biggest first; tap a person to record a payment or settle. */
export function PeopleCard() {
  const { ious } = useMoney();
  const people = useMemo(() => peopleBalances(ious), [ious]);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const toMe = people.filter((p) => p.netMinor > 0).reduce((a, p) => a + p.netMinor, 0);
  const iOwe = people.filter((p) => p.netMinor < 0).reduce((a, p) => a - p.netMinor, 0);
  return (
    <Glass className="flex flex-col gap-2 p-4" aria-label="Who owes whom">
      <div className="flex items-center justify-between">
        <Label>Who owes whom</Label>
        <Button size="sm" variant="ghost" aria-label="Add who owes whom" onClick={() => setAdding(true)}>
          <Plus size={14} />
        </Button>
      </div>
      {people.length ? (
        <>
          <p className="text-[12px] text-orv-muted">
            {toMe ? <span className="text-orv-success">{formatMoney(toMe)} coming to you</span> : null}
            {toMe && iOwe ? ' · ' : null}
            {iOwe ? <span className="text-orv-danger">you owe {formatMoney(iOwe)}</span> : null}
          </p>
          {people.slice(0, 6).map((p) => (
            <button
              key={p.person}
              className="flex items-center gap-3 rounded-orv-md px-1 py-1.5 text-left hover:bg-orv-track"
              onClick={() => setPerson(p.person)}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                style={{
                  background: `color-mix(in srgb, var(${p.netMinor >= 0 ? '--orv-success' : '--orv-danger'}) 15%, transparent)`,
                }}
                aria-hidden
              >
                {p.person.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{p.person}</span>
                <span className="block text-[12px] text-orv-muted">
                  {p.netMinor >= 0 ? 'owes you' : 'you owe'}
                  {p.nextDue
                    ? ` · by ${new Date(`${p.nextDue}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                    : ''}
                </span>
              </span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  p.netMinor >= 0 ? 'text-orv-success' : 'text-orv-danger',
                )}
              >
                {formatMoney(Math.abs(p.netMinor))}
              </span>
            </button>
          ))}
        </>
      ) : (
        <p className="text-small text-orv-muted">
          Lent someone cash, or holding money for someone? Note it here — it counts in what’s in your hand.
        </p>
      )}
      <DebtSheet open={adding} onClose={() => setAdding(false)} />
      <PersonSheet person={person} onClose={() => setPerson(null)} />
    </Glass>
  );
}

export function DebtSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { saveIou, addTransaction, accounts } = useMoney();
  const today = useTodayMaybe();
  const toast = useToast();
  const [dir, setDir] = useState<'owed_to_me' | 'i_owe'>('owed_to_me');
  const [amount, setAmount] = useState('');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [sure, setSure] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reset = () => {
    setAmount('');
    setWho('');
    setNote('');
    setDue('');
    setSure(true);
    setAccountId('');
    setProblem(null);
  };
  const save = async () => {
    const minor = toMinor(amount);
    if (!minor) return setProblem('Enter an amount above zero.');
    if (!who.trim()) return setProblem('Who is it with?');
    const owedToMe = dir === 'owed_to_me';
    let taskId: string | null = null;
    if (due && today) {
      taskId = await today.addTask({
        title: owedToMe
          ? `Get ${formatMoney(minor)} back from ${who.trim()}`
          : `Pay ${who.trim()} back ${formatMoney(minor)}`,
        dueDate: due,
        tags: ['money'],
      });
    }
    const id = await saveIou(null, {
      person: who.trim(),
      direction: dir,
      amountMinor: minor,
      note,
      dueDate: due || null,
      sure: owedToMe ? sure : true,
      taskId,
      startedAt: new Date().toISOString(),
    });
    if (accountId) {
      await addTransaction({
        amountMinor: minor,
        direction: owedToMe ? 'debit' : 'credit',
        title: owedToMe ? `Lent to ${who.trim()}` : `Borrowed from ${who.trim()}`,
        merchant: who.trim(),
        accountId,
        counted: false,
        iouId: id,
        occurredAt: new Date().toISOString(),
        reviewed: true,
      });
    }
    toast({
      title: owedToMe
        ? `${who.trim()} owes you ${formatMoney(minor)}`
        : `You owe ${who.trim()} ${formatMoney(minor)}`,
      body: taskId ? 'A reminder is in Today' : undefined,
      tone: 'success',
    });
    reset();
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Who owes whom"
      footer={
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented<'owed_to_me' | 'i_owe'>
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'owed_to_me', label: 'They owe me' },
            { value: 'i_owe', label: 'I owe them' },
          ]}
        />
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-[28px] text-orv-muted">₹</span>
          <input
            aria-label="Amount"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={cn(
              'w-48 bg-transparent text-center text-[44px] font-semibold tabular-nums outline-none',
              dir === 'owed_to_me' ? 'text-orv-success' : 'text-orv-danger',
            )}
          />
        </div>
        <Field label="Who">
          {(id) => <Input id={id} value={who} onChange={(e) => setWho(e.target.value)} placeholder="Rahul" />}
        </Field>
        <Field label="For what">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cash for his rent"
            />
          )}
        </Field>
        <Field
          label={dir === 'owed_to_me' ? 'Back by' : 'Pay back by'}
          hint="A reminder lands in Today on that day."
        >
          {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        {dir === 'owed_to_me' ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px]">
              Sure to come back
              <span className="block text-[12px] text-orv-muted">Only sure money counts in your hand</span>
            </span>
            <Switch checked={sure} onChange={setSure} label="Sure to come back" />
          </div>
        ) : null}
        {accounts.length ? (
          <Field label={dir === 'owed_to_me' ? 'Money left from' : 'Money came into'}>
            {(id) => (
              <select
                id={id}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="glass-pane h-10 rounded-orv-md px-3 text-[14px]"
              >
                <option value="">It didn’t move now</option>
                {accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        ) : null}
        {problem ? (
          <p role="alert" className="text-small text-orv-danger">
            {problem}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function PersonSheet({ person, onClose }: { person: string | null; onClose(): void }) {
  const { ious, saveIou, removeIou } = useMoney();
  const today = useTodayMaybe();
  const [paying, setPaying] = useState<{ id: string; amount: string } | null>(null);
  const mine = ious.filter((d) => person && d.person.trim().toLowerCase() === person.toLowerCase());
  const open = mine.filter((d) => !d.settledAt);
  const done = mine.filter((d) => d.settledAt);
  const left = (d: Iou) => Math.max(0, d.amountMinor - d.paidMinor);
  const settle = async (d: Iou, paid: number) => {
    const total = Math.min(d.amountMinor, d.paidMinor + paid);
    await saveIou(d.id, {
      paidMinor: total,
      ...(total >= d.amountMinor ? { settledAt: new Date().toISOString() } : {}),
    });
    if (total >= d.amountMinor && d.taskId && today)
      await today.updateTask(d.taskId, { completedAt: new Date().toISOString() });
  };
  return (
    <Sheet open={!!person} onClose={onClose} title={person ?? ''}>
      <div className="flex flex-col gap-3">
        {open.map((d) => (
          <div key={d.id} className="glass-pane flex flex-col gap-2 rounded-orv-md p-3">
            <div className="flex items-center gap-2">
              {d.direction === 'owed_to_me' ? (
                <ArrowDownLeft size={15} className="text-orv-success" aria-hidden />
              ) : (
                <ArrowUpRight size={15} className="text-orv-danger" aria-hidden />
              )}
              <span className="flex-1 text-[14px] font-medium">
                {d.direction === 'owed_to_me' ? 'Owes you' : 'You owe'} {formatMoney(left(d))}
                {d.paidMinor ? (
                  <span className="text-orv-muted"> of {formatMoney(d.amountMinor)}</span>
                ) : null}
              </span>
              {!d.sure ? <span className="text-[11px] text-orv-faint">not sure</span> : null}
            </div>
            {d.note ? <p className="text-[12px] text-orv-muted">{d.note}</p> : null}
            {paying?.id === d.id ? (
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const m = toMinor(paying.amount);
                  if (m) await settle(d, m);
                  setPaying(null);
                }}
              >
                <Input
                  aria-label="Amount paid"
                  inputMode="decimal"
                  autoFocus
                  value={paying.amount}
                  onChange={(e) => setPaying({ id: d.id, amount: e.target.value })}
                />
                <Button type="submit" size="sm" variant="primary">
                  Record
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPaying({ id: d.id, amount: rupees(left(d)) })}
                >
                  {d.direction === 'owed_to_me' ? 'They paid some' : 'I paid some'}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void settle(d, left(d))}>
                  Settled
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void removeIou(d.id)}>
                  Forget it
                </Button>
              </div>
            )}
          </div>
        ))}
        {done.length ? (
          <div className="flex flex-col gap-1">
            <Label>Settled</Label>
            {done.map((d) => (
              <p key={d.id} className="flex justify-between text-[13px] text-orv-muted">
                <span>
                  {d.direction === 'owed_to_me' ? 'Paid you back' : 'You paid back'}
                  {d.note ? ` · ${d.note}` : ''}
                </span>
                <span className="tabular-nums">{formatMoney(d.amountMinor)}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
