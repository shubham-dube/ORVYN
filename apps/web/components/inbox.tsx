'use client';

import { formatMoney, type InboxCategory, type InboxItemView, type InboxView } from '@orvyn/contracts';
import {
  AlarmClock,
  BellOff,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  Megaphone,
  MessageCircleReply,
  MoreHorizontal,
  Newspaper,
  Pin,
  PinOff,
  Plane,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  SquareCheck,
  Star,
  Truck,
  Users,
  Info,
  Mail,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { MailTaskSheet } from '@/components/tools';
import { Glass, SkeletonRows, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { useTodayMaybe } from '@/lib/today';

/** The smart inbox (spec 0017 B): every mailbox, in order of what matters. */

const CAT: Record<InboxCategory, { label: string; icon: ReactNode; tone: string }> = {
  needs_reply: { label: 'Needs a reply', icon: <MessageCircleReply size={12} />, tone: 'var(--orv-accent)' },
  action: { label: 'To do', icon: <SquareCheck size={12} />, tone: 'var(--orv-accent)' },
  bill: { label: 'Bill', icon: <CreditCard size={12} />, tone: 'var(--orv-danger)' },
  money: { label: 'Money', icon: <CircleDollarSign size={12} />, tone: 'var(--orv-success)' },
  security: { label: 'Security', icon: <ShieldAlert size={12} />, tone: 'var(--orv-warning)' },
  travel: { label: 'Travel', icon: <Plane size={12} />, tone: 'var(--orv-accent)' },
  delivery: { label: 'Delivery', icon: <Truck size={12} />, tone: 'var(--orv-success)' },
  event: { label: 'Invite', icon: <CalendarDays size={12} />, tone: 'var(--orv-accent)' },
  work: { label: 'Work', icon: <Briefcase size={12} />, tone: 'var(--orv-muted)' },
  update: { label: 'Update', icon: <Info size={12} />, tone: 'var(--orv-muted)' },
  newsletter: { label: 'Newsletter', icon: <Newspaper size={12} />, tone: 'var(--orv-faint)' },
  promotion: { label: 'Promotion', icon: <Megaphone size={12} />, tone: 'var(--orv-faint)' },
  social: { label: 'Social', icon: <Users size={12} />, tone: 'var(--orv-faint)' },
};
const TONES = ['var(--orv-accent)', 'var(--orv-success)', 'var(--orv-warning)', 'var(--orv-danger)'];
/** Each mailbox keeps its own colour. */
export function accountTone(account: string, all: string[]) {
  const i = Math.max(0, all.indexOf(account));
  return TONES[i % TONES.length]!;
}
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const dueWords = (d: string) => {
  const n = Math.round(
    (Date.parse(`${d}T00:00:00`) - Date.parse(`${new Date().toLocaleDateString('en-CA')}T00:00:00`)) /
      86_400_000,
  );
  return n < 0
    ? 'overdue'
    : n === 0
      ? 'due today'
      : n === 1
        ? 'due tomorrow'
        : `due ${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
};

export function useInbox() {
  const [v, setV] = useState<InboxView | null>(null);
  const load = useCallback(async (fresh = false) => {
    const r = await api<InboxView>(fresh ? '/inbox/refresh' : '/inbox', fresh ? { method: 'POST' } : {});
    setV(r);
    return r;
  }, []);
  useEffect(
    () =>
      void load().catch(() =>
        setV({ catchUp: null, important: [], updates: [], rest: [], boxes: [], refreshedAt: null }),
      ),
    [load],
  );
  return { v, setV, load };
}

export function MailRow({
  m,
  accounts,
  onChanged,
  compact,
}: {
  m: InboxItemView;
  accounts: string[];
  onChanged(v?: InboxView): void;
  compact?: boolean;
}) {
  const toast = useToast();
  const today = useTodayMaybe();
  const [menu, setMenu] = useState(false);
  const [task, setTask] = useState(false);
  const [gone, setGone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  const act = async (action: 'done' | 'pin' | 'unpin' | 'remind') => {
    setMenu(false);
    if (action === 'done') setGone(true);
    const r = await api<{ taskId: string | null }>(`/inbox/items/${m.id}/act`, {
      method: 'POST',
      body: { action },
    });
    if (action === 'remind' && r.taskId)
      toast({ title: 'Reminder set', body: 'A task for tomorrow at 9:00.', tone: 'success' });
    onChanged();
  };
  const sender = async (rule: 'vip' | 'mute' | null) => {
    setMenu(false);
    const v = await api<InboxView>('/inbox/senders', { method: 'PUT', body: { email: m.fromEmail, rule } });
    toast({
      title:
        rule === 'vip'
          ? `${m.fromName || m.fromEmail} is VIP`
          : rule === 'mute'
            ? `${m.fromName || m.fromEmail} muted`
            : 'Back to normal',
      body:
        rule === 'vip'
          ? 'Always in Important from now on.'
          : rule === 'mute'
            ? 'Always in Everything else.'
            : undefined,
    });
    onChanged(v);
  };
  const c = CAT[m.category];
  const tone = accountTone(m.account, accounts);
  if (gone) return null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={spring.snappy}
      className={cn(
        'group relative flex gap-3 rounded-[16px] px-3 py-3 hover:bg-orv-track/60',
        m.pinned && 'bg-[color-mix(in_srgb,var(--orv-accent)_6%,transparent)]',
      )}
    >
      <span
        aria-hidden
        className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white"
        style={{ background: `linear-gradient(135deg, ${tone}, color-mix(in srgb, ${tone} 60%, black))` }}
      >
        {(m.fromName || m.fromEmail).slice(0, 1).toUpperCase()}
        {m.sender === 'vip' ? (
          <Star size={12} className="absolute -right-1 -top-1 fill-current text-orv-warning" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{m.fromName || m.fromEmail}</span>
          {accounts.length > 1 ? (
            <span
              className="truncate rounded-full px-1.5 text-[10.5px] font-medium"
              style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}
            >
              {m.account.split('@')[0]}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-[11.5px] text-orv-faint">{ago(m.at)}</span>
        </div>
        <p className="mt-0.5 text-[14px] leading-snug">{m.summary}</p>
        {!compact ? <p className="truncate text-[12.5px] text-orv-muted">{m.subject}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: c.tone, background: `color-mix(in srgb, ${c.tone} 13%, transparent)` }}
          >
            {c.icon} {c.label}
          </span>
          {m.amountMinor ? (
            <span className="rounded-full bg-orv-track px-2 py-0.5 text-[11px] font-semibold tabular-nums">
              {formatMoney(m.amountMinor)}
            </span>
          ) : null}
          {m.dueDate ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                dueWords(m.dueDate).startsWith('due to') || dueWords(m.dueDate) === 'overdue'
                  ? 'bg-[color-mix(in_srgb,var(--orv-danger)_13%,transparent)] text-orv-danger'
                  : 'bg-orv-track',
              )}
            >
              {dueWords(m.dueDate)}
            </span>
          ) : null}
          {m.pinned ? <Pin size={12} className="text-orv-accent" aria-label="pinned" /> : null}
        </div>
      </div>
      <div
        ref={ref}
        className="relative flex shrink-0 items-start gap-0.5 opacity-70 transition-opacity group-hover:opacity-100"
      >
        {m.url ? (
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${m.subject}`}
            className="grid h-8 w-8 place-items-center rounded-full text-orv-muted hover:bg-orv-track"
          >
            <ExternalLink size={15} />
          </a>
        ) : null}
        {today ? (
          <button
            type="button"
            aria-label={`Make a task: ${m.subject}`}
            onClick={() => setTask(true)}
            className="grid h-8 w-8 place-items-center rounded-full text-orv-muted hover:bg-orv-track"
          >
            <SquareCheck size={15} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Done: ${m.subject}`}
          onClick={() => void act('done')}
          className="grid h-8 w-8 place-items-center rounded-full text-orv-muted hover:bg-orv-track hover:text-orv-success"
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          aria-label="More"
          onClick={() => setMenu((x) => !x)}
          className="grid h-8 w-8 place-items-center rounded-full text-orv-muted hover:bg-orv-track"
        >
          <MoreHorizontal size={15} />
        </button>
        <AnimatePresence>
          {menu ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring.snappy}
              className="glass-float edge-light absolute right-0 top-9 z-30 w-56 rounded-[14px] p-1.5 shadow-lg"
            >
              <Item
                icon={<AlarmClock size={14} />}
                label="Remind me tomorrow"
                onClick={() => void act('remind')}
              />
              <Item
                icon={m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                label={m.pinned ? 'Unpin' : 'Pin'}
                onClick={() => void act(m.pinned ? 'unpin' : 'pin')}
              />
              <div className="my-1 h-px bg-orv-edge" />
              {m.sender !== 'vip' ? (
                <Item
                  icon={<Star size={14} />}
                  label={`Always important`}
                  onClick={() => void sender('vip')}
                />
              ) : null}
              {m.sender !== 'mute' ? (
                <Item
                  icon={<BellOff size={14} />}
                  label="Mute this sender"
                  onClick={() => void sender('mute')}
                />
              ) : null}
              {m.sender ? (
                <Item
                  icon={<RefreshCw size={14} />}
                  label="Treat normally"
                  onClick={() => void sender(null)}
                />
              ) : null}
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-orv-faint">{m.fromEmail}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {task && today ? (
        <MailTaskSheet
          mail={{
            id: m.id,
            from: `${m.fromName} <${m.fromEmail}>`,
            subject: m.subject,
            snippet: m.snippet,
            url: m.url,
          }}
          onClose={() => setTask(false)}
        />
      ) : null}
    </motion.div>
  );
}

function Item({ icon, label, onClick }: { icon: ReactNode; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13.5px] hover:bg-orv-track"
    >
      {icon} {label}
    </button>
  );
}

function Group({
  title,
  items,
  accounts,
  onChanged,
  collapsed,
  hint,
}: {
  title: string;
  items: InboxItemView[];
  accounts: string[];
  onChanged(v?: InboxView): void;
  collapsed?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(!collapsed);
  if (!items.length) return null;
  return (
    <Glass level="pane" as="section" aria-label={title} className="flex flex-col p-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 text-left"
      >
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <span className="rounded-full bg-orv-track px-2 text-[12px] font-semibold tabular-nums">
          {items.length}
        </span>
        {hint ? <span className="text-[12px] text-orv-muted">{hint}</span> : null}
        <ChevronDown
          size={15}
          className={cn('ml-auto text-orv-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <AnimatePresence>
              {items.map((m) => (
                <MailRow key={m.id} m={m} accounts={accounts} onChanged={onChanged} />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Glass>
  );
}

/** The Mail page: the catch-up, then Important, Updates and Everything else, across every mailbox. */
export function SmartInbox() {
  const { v, setV, load } = useInbox();
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState('');
  const accounts = v?.boxes.map((b) => b.account) ?? [];
  const pick = (xs: InboxItemView[]) => (box ? xs.filter((m) => m.account === box) : xs);
  const changed = (n?: InboxView) => (n ? setV(n) : void load().catch(() => undefined));
  const total = v ? v.important.length + v.updates.length + v.rest.length : 0;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">
            {v
              ? `${total} unread across ${v.boxes.length} ${v.boxes.length === 1 ? 'mailbox' : 'mailboxes'}`
              : 'Reading your mailboxes…'}
          </span>
          <h1 className="text-title font-semibold">Mail</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await load(true).finally(() => setBusy(false));
          }}
        >
          <RefreshCw size={14} /> Check now
        </Button>
      </header>
      {v && v.boxes.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 px-1" role="radiogroup" aria-label="Mailbox">
          {['', ...accounts].map((a) => (
            <button
              key={a || 'all'}
              type="button"
              role="radio"
              aria-checked={box === a}
              onClick={() => setBox(a)}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px]',
                box === a
                  ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] font-medium text-orv-accent'
                  : 'border-orv-edge text-orv-muted hover:bg-orv-track',
              )}
            >
              {a ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: accountTone(a, accounts) }} />
                  {a}
                </span>
              ) : (
                'All mailboxes'
              )}
            </button>
          ))}
        </div>
      ) : null}
      {v?.boxes
        .filter((b) => b.problem)
        .map((b) => (
          <p key={b.connectionId} className="px-1 text-[12.5px] text-orv-danger">
            {b.account}: {b.problem}
          </p>
        ))}
      {!v ? (
        <SkeletonRows rows={5} label="Reading your mail" />
      ) : !v.boxes.length ? (
        <Glass level="pane" className="flex flex-col items-center gap-3 p-8 text-center">
          <Mail size={28} className="text-orv-accent" />
          <p className="text-[15px] font-semibold">Connect your mailboxes</p>
          <p className="max-w-md text-small text-orv-muted">
            Add Gmail to a Google account, or any mailbox with an app password, in Settings → Connections.
            ORVYN reads unread mail (never changes it) and puts what matters first.
          </p>
        </Glass>
      ) : (
        <>
          {v.catchUp && !box ? (
            <Glass level="float" className="relative overflow-hidden p-5">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[image:var(--orv-accent-grad)] opacity-20 blur-3xl"
              />
              <p className="relative flex items-center gap-1.5 text-[12px] font-semibold text-orv-accent">
                <Sparkles size={13} /> Catch up
              </p>
              <p className="relative mt-1 text-[16px] leading-relaxed">{v.catchUp}</p>
            </Glass>
          ) : null}
          <Group
            title="Important"
            items={pick(v.important)}
            accounts={accounts}
            onChanged={changed}
            hint="people waiting, money due, security"
          />
          <Group
            title="Updates"
            items={pick(v.updates)}
            accounts={accounts}
            onChanged={changed}
            hint="deliveries, travel, invites"
          />
          <Group
            title="Everything else"
            items={pick(v.rest)}
            accounts={accounts}
            onChanged={changed}
            collapsed
            hint="newsletters, promotions, social"
          />
          {!total ? (
            <p className="px-1 text-small text-orv-muted">Inbox zero across every mailbox. Lovely.</p>
          ) : null}
          <p className="px-1 text-[11.5px] text-orv-faint">
            Read-only: nothing is marked or moved in your mailboxes. Sorted by AI from unread mail of the last
            week.
          </p>
        </>
      )}
    </div>
  );
}
