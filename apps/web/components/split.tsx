'use client';

import {
  formatMoney,
  MONEY_TRANSACTION,
  SPLIT_CATEGORIES,
  type SplitExpenseView,
  type SplitMemberView,
} from '@orvyn/contracts';
import { shares, SplitError } from '@orvyn/money';
import {
  Bell,
  Copy,
  Link2,
  MessageCircle,
  Plus,
  Receipt,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ShareToChat } from '@/components/chat';
import { Badge, Glass, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync';

const m = (paise: number) => formatMoney(paise);
const KIND_EMOJI: Record<string, string> = { trip: '🧳', party: '🎉', home: '🏠', other: '👥' };
const CAT_EMOJI: Record<string, string> = {
  food: '🍽️',
  stay: '🏨',
  travel: '🚕',
  drinks: '🍻',
  tickets: '🎟️',
  shopping: '🛍️',
  other: '🧾',
};
const today = () => new Date().toISOString().slice(0, 10);

interface GroupSummary {
  id: string;
  name: string;
  kind: string;
  members: number;
  totalMinor: number;
  myBalance: number;
  lastAt: string;
  archived: boolean;
}
export interface Group {
  id: string;
  name: string;
  kind: string;
  adminId: string;
  conversationId: string | null;
  archived: boolean;
  members: SplitMemberView[];
  expenses: SplitExpenseView[];
  settlements: {
    id: string;
    fromId: string;
    toId: string;
    amount: number;
    method: string;
    date: string;
    note: string;
  }[];
  plan: { from: string; to: string; amount: number; fromName: string; toName: string; toUpi: string }[];
  totalMinor: number;
  byCategory: { category: string; amount: number }[];
  activity: { text: string; at: string }[];
}

function Owe({ v, big }: { v: number; big?: boolean }) {
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        big && 'text-[22px]',
        v > 0 ? 'text-orv-success' : v < 0 ? 'text-orv-danger' : 'text-orv-muted',
      )}
    >
      {v === 0 ? 'settled' : v > 0 ? `gets ${m(v)}` : `owes ${m(-v)}`}
    </span>
  );
}

// ------------------------------------------------------------------ groups

/** the last list this tab saw, shown at once on the way back */
let lastGroups: GroupSummary[] | null = null;

export function SplitHome() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(lastGroups);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const load = useCallback(() => {
    setFailed(false);
    return api<GroupSummary[]>('/split/groups').then(
      (g) => {
        lastGroups = g;
        setGroups(g);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => void load(), [load]);
  const owe = (groups ?? []).filter((g) => g.myBalance < 0).reduce((s, g) => s - g.myBalance, 0);
  const get = (groups ?? []).filter((g) => g.myBalance > 0).reduce((s, g) => s + g.myBalance, 0);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">Trips, parties, home — who paid, who owes</span>
          <h1 className="text-title font-semibold">Split</h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New group
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Glass level="pane" className="p-4">
          <p className="text-[11.5px] uppercase tracking-wide text-orv-muted">You get back</p>
          <p className="text-[22px] font-semibold text-orv-success">{m(get)}</p>
        </Glass>
        <Glass level="pane" className="p-4">
          <p className="text-[11.5px] uppercase tracking-wide text-orv-muted">You owe</p>
          <p className="text-[22px] font-semibold text-orv-danger">{m(owe)}</p>
        </Glass>
      </div>
      {groups === null && failed ? (
        <Glass level="pane" className="p-6 text-center">
          <p className="text-[15px] font-semibold">Couldn’t load your groups</p>
          <Button className="mt-3" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </Glass>
      ) : groups === null ? (
        <SkeletonRows rows={3} label="Loading groups" />
      ) : !groups.length ? (
        <Glass level="pane" className="p-6 text-center">
          <p className="text-[15px] font-semibold">No groups yet</p>
          <p className="mt-1 text-small text-orv-muted">
            Make one for a trip or a party — add friends on ORVYN, or anyone as a guest with just a name.
          </p>
        </Glass>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/split/${g.id}`}>
              <Glass
                level="pane"
                className={cn(
                  'flex items-center gap-3 p-4 hover:-translate-y-0.5',
                  g.archived && 'opacity-60',
                )}
              >
                <span className="text-[26px]" aria-hidden>
                  {KIND_EMOJI[g.kind] ?? '👥'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{g.name}</p>
                  <p className="text-[12.5px] text-orv-muted">
                    {g.members} people · {m(g.totalMinor)} spent
                  </p>
                </div>
                <Owe v={g.myBalance} />
              </Glass>
            </Link>
          ))}
        </div>
      )}
      {creating ? (
        <NewGroupSheet onClose={() => setCreating(false)} onMade={(id) => router.push(`/split/${id}`)} />
      ) : null}
    </div>
  );
}

function NewGroupSheet({ onClose, onMade }: { onClose(): void; onMade(id: string): void }) {
  const toast = useToast();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('trip');
  const [people, setPeople] = useState<{ id: string; name: string; email: string }[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState<{ name: string; phone: string }[]>([]);
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [withChat, setWithChat] = useState(true);
  useEffect(
    () =>
      void api<typeof people>('/split/groups/people')
        .then(setPeople)
        .catch(() => undefined),
    [],
  );
  const canChat = me?.role === 'owner' || me?.entitlements.includes('chat');
  return (
    <Sheet
      open
      onClose={onClose}
      title="New group"
      subtitle="Everyone can add expenses; ORVYN works out who owes whom."
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const g = await api<{ id: string }>('/split/groups', {
                method: 'POST',
                body: {
                  name: name.trim(),
                  kind,
                  memberIds: [...chosen],
                  guests,
                  withChat: withChat && canChat,
                },
              });
              onMade(g.id);
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t make it', tone: 'danger' });
            }
          }}
        >
          Make the group
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              autoFocus
              placeholder="Goa trip"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
          {Object.entries(KIND_EMOJI).map(([k, e]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'h-9 rounded-full border px-3 text-[13px] capitalize',
                kind === k ? 'border-orv-accent text-orv-accent' : 'border-orv-edge text-orv-muted',
              )}
            >
              {e} {k}
            </button>
          ))}
        </div>
        {people.length ? (
          <div>
            <Label className="mb-2 block">Friends on ORVYN</Label>
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-3 py-1 text-[14px]">
                <input
                  type="checkbox"
                  checked={chosen.has(p.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(p.id);
                    else n.delete(p.id);
                    setChosen(n);
                  }}
                />
                {p.name || p.email.split('@')[0]}
              </label>
            ))}
          </div>
        ) : null}
        <div>
          <Label className="mb-2 block">Guests (not on ORVYN)</Label>
          {guests.map((g, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-[14px]">
              <span className="flex-1">{g.name}</span>
              <span className="text-orv-muted">{g.phone}</span>
              <button
                type="button"
                aria-label={`Remove ${g.name}`}
                onClick={() => setGuests(guests.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Guest name">
                {(id) => (
                  <Input
                    id={id}
                    value={guest.name}
                    onChange={(e) => setGuest({ ...guest, name: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="w-36">
              <Field label="Phone">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="tel"
                    value={guest.phone}
                    onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Button
              variant="ghost"
              disabled={!guest.name.trim()}
              onClick={() => {
                setGuests([...guests, { name: guest.name.trim(), phone: guest.phone.trim() }]);
                setGuest({ name: '', phone: '' });
              }}
            >
              Add
            </Button>
          </div>
        </div>
        {canChat ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[14px]">Also make a group chat</span>
            <Switch label="Group chat" checked={withChat} onChange={setWithChat} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ one group

export function GroupView({ id }: { id: string }) {
  const toast = useToast();
  const { me } = useSession();
  const { write } = useSync();
  const [g, setG] = useState<Group | null>(null);
  const [expense, setExpense] = useState<SplitExpenseView | 'new' | null>(null);
  const [pay, setPay] = useState<{ fromId: string; toId: string; amount: number } | null>(null);
  const [addPerson, setAddPerson] = useState(false);
  const [share, setShare] = useState(false);
  const load = useCallback(() => api<Group>(`/split/groups/${id}`).then(setG), [id]);
  useEffect(() => {
    void load().catch(() => undefined);
    return realtime?.on((msg) => {
      if (msg.type === 'split.changed' && msg.groupId === id) void load();
    });
  }, [id, load]);
  const name = useMemo(() => new Map((g?.members ?? []).map((x) => [x.id, x.name])), [g]);
  if (!g) return <SkeletonRows rows={6} label="Loading the group" />;
  const mine = g.members.find((x) => x.userId === me?.id);
  const remind = async (memberId: string) => {
    try {
      const r = await api<{ sent: boolean; whatsapp?: string }>(
        `/split/groups/${id}/members/${memberId}/remind`,
        { method: 'POST' },
      );
      if (r.whatsapp) window.open(r.whatsapp, '_blank', 'noopener');
      else toast({ title: 'Reminder sent', tone: 'success' });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t remind', tone: 'danger' });
    }
  };
  const addToMoney = async (e: SplitExpenseView) => {
    const share = e.shares.find((s) => s.memberId === mine?.id)?.amount ?? 0;
    if (!share) return;
    await write((c) =>
      c.upsert(MONEY_TRANSACTION, {
        amountMinor: share,
        direction: 'debit',
        occurredAt: new Date(`${e.date}T12:00:00`).toISOString(),
        merchant: e.title,
        note: `My share in ${g.name} (Split)`,
        source: 'manual',
      }),
    );
    toast({ title: `${m(share)} added to Money`, tone: 'success' });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3 px-1 pt-2">
        <div className="min-w-0 flex-1">
          <span className="text-small text-orv-muted">
            {KIND_EMOJI[g.kind]} {g.members.length} people · {m(g.totalMinor)} spent
          </span>
          <h1 className="text-title font-semibold">{g.name}</h1>
        </div>
        {g.conversationId ? (
          <Link href={`/chat/${g.conversationId}`}>
            <Button variant="ghost" size="sm">
              <MessageCircle size={14} /> Chat
            </Button>
          </Link>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            const { text } = await api<{ text: string }>(`/split/groups/${id}/summary`);
            await navigator.clipboard.writeText(text);
            toast({ title: 'Summary copied — paste it anywhere' });
          }}
        >
          <Copy size={14} /> Summary
        </Button>
        {me?.role === 'owner' || me?.entitlements.includes('chat') ? (
          <Button variant="ghost" size="sm" onClick={() => setShare(true)}>
            <Share2 size={14} /> Share
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={() => setExpense('new')}>
          <Plus size={14} /> Add expense
        </Button>
      </header>

      {mine ? (
        <Glass level="pane" as="section" className="flex items-center gap-3 p-5" aria-label="Your balance">
          <div className="flex-1">
            <p className="text-[11.5px] uppercase tracking-wide text-orv-muted">You</p>
            <Owe v={mine.balance} big />
            <p className="text-[12.5px] text-orv-muted">
              paid {m(mine.paid)} · your share {m(mine.consumed)}
            </p>
          </div>
        </Glass>
      ) : null}

      <Glass level="pane" as="section" aria-label="Settle up" className="flex flex-col gap-2 p-5">
        <h2 className="text-[14px] font-semibold">Settle up</h2>
        {!g.plan.length ? (
          <p className="text-small text-orv-muted">Everyone is square. 🎉</p>
        ) : (
          g.plan.map((t, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 border-b border-orv-edge py-2 last:border-0"
            >
              <span className="min-w-0 flex-1 text-[14px]">
                <strong>{t.fromName}</strong> → <strong>{t.toName}</strong>
                {t.toUpi ? <span className="text-[12px] text-orv-muted"> · UPI {t.toUpi}</span> : null}
              </span>
              <span className="text-[15px] font-semibold tabular-nums">{m(t.amount)}</span>
              {t.toUpi && mine?.id === t.from ? (
                <a
                  className="inline-flex h-8 items-center rounded-full px-3 text-[13px] text-orv-accent hover:underline"
                  href={`upi://pay?pa=${encodeURIComponent(t.toUpi)}&pn=${encodeURIComponent(t.toName)}&am=${(t.amount / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(g.name)}`}
                >
                  Pay by UPI
                </a>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPay({ fromId: t.from, toId: t.to, amount: t.amount })}
              >
                <Send size={13} /> Record payment
              </Button>
              {mine?.id !== t.from ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remind ${t.fromName}`}
                  onClick={() => void remind(t.from)}
                >
                  <Bell size={13} /> Remind
                </Button>
              ) : null}
            </div>
          ))
        )}
      </Glass>

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <Glass level="pane" as="section" aria-label="Expenses" className="flex flex-col gap-1 p-5">
          <h2 className="mb-1 text-[14px] font-semibold">Expenses</h2>
          {!g.expenses.length ? (
            <p className="text-small text-orv-muted">Nothing yet — add the first bill.</p>
          ) : null}
          {g.expenses.map((e) => {
            const myShare = e.shares.find((s) => s.memberId === mine?.id)?.amount ?? 0;
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-orv-edge py-2.5 last:border-0"
              >
                <span className="text-[20px]" aria-hidden>
                  {CAT_EMOJI[e.category] ?? '🧾'}
                </span>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpense(e)}>
                  <p className="truncate text-[14px] font-medium">{e.title}</p>
                  <p className="truncate text-[12px] text-orv-muted">
                    {new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · paid by {e.paid.map((p) => name.get(p.memberId)).join(' + ')} · {e.method}
                  </p>
                </button>
                <div className="text-right">
                  <p className="text-[14px] font-semibold tabular-nums">{m(e.amount)}</p>
                  {myShare ? <p className="text-[12px] text-orv-muted">you {m(myShare)}</p> : null}
                </div>
                {myShare ? (
                  <button
                    type="button"
                    title="Add my share to Money"
                    aria-label={`Add my share of ${e.title} to Money`}
                    className="text-orv-faint hover:text-orv-accent"
                    onClick={() => void addToMoney(e)}
                  >
                    <Wallet size={15} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {g.settlements.length ? (
            <>
              <h3 className="mt-3 text-[13px] font-semibold text-orv-muted">Payments back</h3>
              {g.settlements.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <span className="flex-1">
                    {name.get(s.fromId)} paid {name.get(s.toId)} · {s.method}
                  </span>
                  <span className="tabular-nums">{m(s.amount)}</span>
                  <button
                    type="button"
                    aria-label="Remove this payment"
                    className="text-orv-faint hover:text-orv-danger"
                    onClick={async () => {
                      if (!window.confirm('Remove this payment?')) return;
                      setG(await api<Group>(`/split/groups/${id}/settlements/${s.id}`, { method: 'DELETE' }));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
        </Glass>

        <div className="flex flex-col gap-4">
          <Glass level="pane" as="section" aria-label="People" className="flex flex-col gap-2 p-5">
            <div className="flex items-center">
              <h2 className="flex-1 text-[14px] font-semibold">People</h2>
              <Button size="sm" variant="ghost" onClick={() => setAddPerson(true)}>
                <UserPlus size={13} /> Add
              </Button>
            </div>
            {g.members.map((x) => (
              <div key={x.id} className="flex items-center gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">
                  {x.name} {x.guest ? <Badge>guest</Badge> : null}
                </span>
                <Owe v={x.balance} />
                {x.guest ? (
                  <button
                    type="button"
                    title="Their private link"
                    aria-label={`Link for ${x.name}`}
                    className="text-orv-faint hover:text-orv-accent"
                    onClick={async () => {
                      const l = await api<{ url: string }>(`/split/groups/${id}/members/${x.id}/link`, {
                        method: 'POST',
                      });
                      await navigator.clipboard.writeText(l.url);
                      toast({
                        title: `${x.name}’s link copied`,
                        body: 'They see the group read-only, nothing else.',
                      });
                    }}
                  >
                    <Link2 size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </Glass>
          {g.byCategory.length ? (
            <Glass level="pane" as="section" aria-label="By category" className="flex flex-col gap-1 p-5">
              <h2 className="text-[14px] font-semibold">Where it went</h2>
              {g.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 capitalize">
                    {CAT_EMOJI[c.category]} {c.category}
                  </span>
                  <span className="tabular-nums">{m(c.amount)}</span>
                </div>
              ))}
            </Glass>
          ) : null}
          <Glass level="pane" as="section" aria-label="Activity" className="flex flex-col gap-1 p-5">
            <h2 className="text-[14px] font-semibold">Activity</h2>
            {g.activity.slice(0, 12).map((a, i) => (
              <p key={i} className="text-[12.5px] text-orv-muted">
                {a.text}
              </p>
            ))}
          </Glass>
        </div>
      </div>

      {expense ? (
        <ExpenseSheet
          group={g}
          expense={expense === 'new' ? null : expense}
          me={mine?.id ?? null}
          onClose={() => setExpense(null)}
          onSaved={(ng) => setG(ng)}
        />
      ) : null}
      {pay ? (
        <PaymentSheet group={g} initial={pay} onClose={() => setPay(null)} onSaved={(ng) => setG(ng)} />
      ) : null}
      {addPerson ? (
        <AddPersonSheet groupId={id} onClose={() => setAddPerson(false)} onSaved={(ng) => setG(ng)} />
      ) : null}
      {share ? (
        <ShareToChat
          item={{
            kind: 'split',
            id: g.id,
            title: g.name,
            line: `${m(g.totalMinor)} spent · ${g.members.length} people`,
          }}
          onClose={() => setShare(false)}
        />
      ) : null}
    </div>
  );
}

const METHOD_LABEL = { equal: 'Equally', exact: 'Exact ₹', percent: '%', shares: 'Shares' } as const;
type Method = keyof typeof METHOD_LABEL;

/** Add or change an expense: who paid (one or several), and how it splits — with a live preview. */
function ExpenseSheet({
  group,
  expense,
  me,
  onClose,
  onSaved,
}: {
  group: Group;
  expense: SplitExpenseView | null;
  me: string | null;
  onClose(): void;
  onSaved(g: Group): void;
}) {
  const toast = useToast();
  const people = group.members;
  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount / 100) : '');
  const [date, setDate] = useState(expense?.date ?? today());
  const [category, setCategory] = useState(expense?.category ?? 'food');
  const [many, setMany] = useState((expense?.paid.length ?? 1) > 1);
  const [payer, setPayer] = useState(expense?.paid[0]?.memberId ?? me ?? people[0]!.id);
  const [paid, setPaid] = useState<Record<string, string>>(
    Object.fromEntries((expense?.paid ?? []).map((p) => [p.memberId, String(p.amount / 100)])),
  );
  const [method, setMethod] = useState<Method>((expense?.method as Method) ?? 'equal');
  const [among, setAmong] = useState<Record<string, string>>(
    expense
      ? Object.fromEntries(
          expense.among.map((a) => [a.memberId, method === 'exact' ? String(a.value) : String(a.value)]),
        )
      : Object.fromEntries(people.map((p) => [p.id, '1'])),
  );
  const total = Math.round((Number(amount) || 0) * 100);
  const chosen = Object.keys(among).filter(
    (k) => among[k] !== '' && (method !== 'equal' || among[k] !== '0'),
  );
  const preview = useMemo(() => {
    try {
      if (!total) return null;
      return shares({
        total,
        method,
        among: chosen.map((memberId) => ({
          memberId,
          value:
            method === 'exact' ? Math.round(Number(among[memberId]) * 100) : Number(among[memberId]) || 0,
        })),
      });
    } catch (e) {
      return e instanceof SplitError ? e.message : null;
    }
  }, [total, method, chosen, among]);
  const paidSum = Object.values(paid).reduce((s, v) => s + Math.round((Number(v) || 0) * 100), 0);
  const ok =
    title.trim() && total > 0 && preview && typeof preview !== 'string' && (!many || paidSum === total);
  const save = async () => {
    const body = {
      title: title.trim(),
      amount: total / 100,
      date,
      category,
      paid: many
        ? Object.entries(paid)
            .filter(([, v]) => Number(v) > 0)
            .map(([memberId, v]) => ({ memberId, amount: Number(v) }))
        : [{ memberId: payer, amount: total / 100 }],
      split: { method, among: chosen.map((memberId) => ({ memberId, value: Number(among[memberId]) || 0 })) },
    };
    try {
      const g = await api<Group>(
        expense ? `/split/groups/${group.id}/expenses/${expense.id}` : `/split/groups/${group.id}/expenses`,
        {
          method: expense ? 'PUT' : 'POST',
          body,
        },
      );
      onSaved(g);
      onClose();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
    }
  };
  const row = (label: ReactNode, input: ReactNode, right?: ReactNode) => (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[14px]">{label}</span>
      {input}
      {right}
    </div>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={expense ? 'Change the expense' : 'Add an expense'}
      subtitle={group.name}
      footer={
        <>
          {expense ? (
            <Button
              variant="ghost"
              onClick={async () => {
                if (!window.confirm(`Remove “${expense.title}”?`)) return;
                try {
                  onSaved(
                    await api<Group>(`/split/groups/${group.id}/expenses/${expense.id}`, {
                      method: 'DELETE',
                    }),
                  );
                  onClose();
                } catch (e) {
                  toast({ title: e instanceof ApiError ? e.message : 'Couldn’t remove it', tone: 'danger' });
                }
              }}
            >
              <Trash2 size={14} /> Remove
            </Button>
          ) : null}
          <Button variant="primary" disabled={!ok} onClick={() => void save()}>
            <Receipt size={14} /> Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="What for">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={title}
                placeholder="Dinner at Thalassa"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)">
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field label="Date">
              {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
            {SPLIT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  'h-8 rounded-full border px-2.5 text-[12.5px] capitalize',
                  category === c ? 'border-orv-accent text-orv-accent' : 'border-orv-edge text-orv-muted',
                )}
              >
                {CAT_EMOJI[c]} {c}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Label className="flex-1">Who paid</Label>
              <span className="text-[12.5px] text-orv-muted">Several people</span>
              <Switch label="Several people paid" checked={many} onChange={setMany} />
            </div>
            {!many ? (
              <select
                aria-label="Paid by"
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                className="h-10 w-full rounded-orv-md field-ring px-3 text-[14px]"
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                {people.map((p) =>
                  row(
                    p.name,
                    <Input
                      aria-label={`${p.name} paid`}
                      className="w-28"
                      inputMode="decimal"
                      value={paid[p.id] ?? ''}
                      onChange={(e) => setPaid({ ...paid, [p.id]: e.target.value })}
                    />,
                  ),
                )}
                <p
                  className={cn('text-[12.5px]', paidSum === total ? 'text-orv-success' : 'text-orv-warning')}
                >
                  Contributions {m(paidSum)} of {m(total)}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>How it splits</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Split method">
            {(Object.keys(METHOD_LABEL) as Method[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={method === k}
                onClick={() => {
                  setMethod(k);
                  setAmong(
                    Object.fromEntries(
                      people.map((p) => [
                        p.id,
                        k === 'equal' || k === 'shares'
                          ? '1'
                          : k === 'percent'
                            ? String(Math.round(100 / people.length))
                            : '',
                      ]),
                    ),
                  );
                }}
                className={cn(
                  'h-8 rounded-full border px-3 text-[13px]',
                  method === k ? 'border-orv-accent text-orv-accent' : 'border-orv-edge text-orv-muted',
                )}
              >
                {METHOD_LABEL[k]}
              </button>
            ))}
          </div>
          {people.map((p) =>
            row(
              p.name,
              method === 'equal' ? (
                <input
                  type="checkbox"
                  aria-label={`${p.name} shares this`}
                  checked={among[p.id] === '1'}
                  onChange={(e) => setAmong({ ...among, [p.id]: e.target.checked ? '1' : '0' })}
                />
              ) : (
                <Input
                  aria-label={`${p.name} ${method}`}
                  className="w-24"
                  inputMode="decimal"
                  value={among[p.id] ?? ''}
                  onChange={(e) => setAmong({ ...among, [p.id]: e.target.value })}
                />
              ),
              <span className="w-24 text-right text-[13px] tabular-nums text-orv-muted">
                {preview && typeof preview !== 'string' && preview.has(p.id) ? m(preview.get(p.id)!) : '—'}
              </span>,
            ),
          )}
          {typeof preview === 'string' ? <p className="text-[12.5px] text-orv-danger">{preview}</p> : null}
        </div>
      </div>
    </Sheet>
  );
}

function PaymentSheet({
  group,
  initial,
  onClose,
  onSaved,
}: {
  group: Group;
  initial: { fromId: string; toId: string; amount: number };
  onClose(): void;
  onSaved(g: Group): void;
}) {
  const [f, setF] = useState({
    ...initial,
    amount: String(initial.amount / 100),
    method: 'UPI',
    date: today(),
  });
  const pick = (label: string, v: string, set: (x: string) => void) => (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={v}
          onChange={(e) => set(e.target.value)}
          className="h-10 w-full rounded-orv-md field-ring px-3 text-[14px]"
        >
          {group.members.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record a payment"
      subtitle="Money that changed hands to settle up. ORVYN never moves money."
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            onSaved(
              await api<Group>(`/split/groups/${group.id}/settlements`, {
                method: 'POST',
                body: { ...f, amount: Number(f.amount) },
              }),
            );
            onClose();
          }}
        >
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {pick('Who paid', f.fromId, (v) => setF({ ...f, fromId: v }))}
        {pick('To whom', f.toId, (v) => setF({ ...f, toId: v }))}
        <Field label="Amount (₹)">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          )}
        </Field>
        <Field label="How">
          {(id) => (
            <select
              id={id}
              value={f.method}
              onChange={(e) => setF({ ...f, method: e.target.value })}
              className="h-10 w-full rounded-orv-md field-ring px-3 text-[14px]"
            >
              {['UPI', 'Cash', 'Bank'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </Sheet>
  );
}

function AddPersonSheet({
  groupId,
  onClose,
  onSaved,
}: {
  groupId: string;
  onClose(): void;
  onSaved(g: Group): void;
}) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', phone: '', upi: '' });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a guest"
      subtitle="Someone not on ORVYN. They can see the group through a private link."
      footer={
        <Button
          variant="primary"
          disabled={!f.name.trim()}
          onClick={async () => {
            try {
              onSaved(await api<Group>(`/split/groups/${groupId}/members`, { method: 'POST', body: f }));
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t add', tone: 'danger' });
            }
          }}
        >
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Field label="Phone (for WhatsApp reminders)">
          {(id) => (
            <Input
              id={id}
              inputMode="tel"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          )}
        </Field>
        <Field label="UPI ID (to be paid back)">
          {(id) => <Input id={id} value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value })} />}
        </Field>
      </div>
    </Sheet>
  );
}
