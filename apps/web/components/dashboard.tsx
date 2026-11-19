'use client';

import { smartParse, taskFields } from '@/lib/smart-task';

import { formatMoney, type Transaction } from '@orvyn/contracts';
import { budgetProgress, dailySpend, monthOf, parseSpend, summarise } from '@orvyn/money';
import { expiringSoon, expiry, expiryLabel } from '@orvyn/library';
import { dayShape, expandEvents, type NextItem, weekAhead } from '@orvyn/today-plan';
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  FileClock,
  Inbox,
  ListTodo,
  Plus,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge, Glass, Label, Segmented, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useDropMaybe } from '@/lib/drop';
import { useLibraryMaybe } from '@/lib/library';
import { useMoneyMaybe } from '@/lib/money';
import { spring } from '@/lib/motion';
import { useNotifications } from '@/lib/notifications';
import { localDay, useTodayMaybe } from '@/lib/today';

const tzOf = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** A ring that fills as the day's tasks get done. */
export function ProgressRing({
  value,
  size = 112,
  label,
  sub,
}: {
  value: number;
  size?: number;
  label: string;
  sub: string;
}) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}. ${Math.round(value * 100)} percent done`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--orv-accent-from)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--orv-accent-to)' }} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={9}
          style={{ stroke: 'var(--orv-track)' }}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={9}
          strokeLinecap="round"
          stroke="url(#ring-grad)"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={spring.gentle}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[22px] font-semibold leading-none tabular-nums">{label}</span>
        <span className="mt-1 text-[11px] text-orv-muted">{sub}</span>
      </div>
    </div>
  );
}

/** A small line of daily spend; the last point glows. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 220;
  const h = 56;
  const max = Math.max(1, ...values);
  const pts = values.map(
    (v, i) => [(i / Math.max(1, values.length - 1)) * (w - 8) + 4, h - 6 - (v / max) * (h - 14)] as const,
  );
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = pts.length
    ? `${line} L${pts.at(-1)![0].toFixed(1)} ${h} L${pts[0]![0].toFixed(1)} ${h} Z`
    : '';
  const last = pts.at(-1);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-14 w-full"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--orv-accent-from)', stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: 'var(--orv-accent-from)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill="url(#spark-fill)" /> : null}
      {line ? (
        <path
          d={line}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: 'var(--orv-accent-from)' }}
        />
      ) : null}
      {last ? <circle cx={last[0]} cy={last[1]} r={3.5} style={{ fill: 'var(--orv-accent-from)' }} /> : null}
    </svg>
  );
}

function Card({
  title,
  icon,
  href,
  action,
  children,
  className,
  testId,
}: {
  title: string;
  icon: ReactNode;
  href?: string;
  action?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Glass level="pane" className={cn('flex flex-col gap-3 p-5', className)} aria-label={title}>
      <div className="flex items-center justify-between" data-testid={testId}>
        <span className="flex items-center gap-2 text-orv-accent">
          {icon}
          <Label>{title}</Label>
        </span>
        {href ? (
          <Link
            href={href}
            className="flex items-center gap-1 text-[12px] text-orv-muted hover:text-orv-text"
          >
            {action ?? 'Open'} <ArrowRight size={12} aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </Glass>
  );
}

/** The day at a glance: ring, one line, what's next. */
export function TodayCard({ now }: { now: Date }) {
  const today = useTodayMaybe();
  const tz = tzOf();
  const shape = useMemo(() => {
    if (!today?.ready) return null;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const hidden = new Set(today.calendars.filter((c) => !c.visible).map((c) => c.id));
    return dayShape(today.tasks, expandEvents(today.events, start, end, hidden), now, tz, hm);
  }, [today, now, tz]);
  if (!today) return null;
  const total = (shape?.open ?? 0) + (shape?.doneToday ?? 0);
  return (
    <Card
      title="Today"
      icon={<ListTodo size={15} aria-hidden />}
      href="/today"
      action="Open Today"
      className="md:col-span-2"
      testId="dash-today"
    >
      {!shape ? (
        <div className="skeleton h-24 rounded-orv-md" />
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <ProgressRing
            value={shape.progress}
            label={total ? `${shape.doneToday}/${total}` : '✓'}
            sub={total ? 'done' : 'nothing due'}
          />
          <div className="min-w-0 flex-1">
            <p className="text-heading font-semibold capitalize-first" data-testid="dash-line">
              {shape.line}
            </p>
            {shape.overdue ? (
              <p className="mt-0.5 text-small text-orv-danger">
                {shape.overdue} overdue — still on your plate
              </p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-1.5" aria-label="What's next">
              {shape.next.slice(0, 5).map((n) => (
                <NextRow key={`${n.kind}-${n.id}`} n={n} />
              ))}
              {!shape.next.length ? (
                <li className="text-small text-orv-muted">
                  {total
                    ? 'Nothing left on the clock today.'
                    : 'Nothing planned. Add something below, or enjoy it.'}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

function NextRow({ n }: { n: NextItem }) {
  return (
    <li className="flex items-center gap-3 text-[14px]">
      <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-orv-muted">
        {n.allDay ? 'All day' : n.at ? hm(n.at) : 'Anytime'}
      </span>
      <span
        aria-hidden
        className={cn(
          'h-5 w-1 shrink-0 rounded-full',
          n.kind === 'event' ? '[background:var(--orv-accent-grad)]' : 'bg-orv-edge',
        )}
      />
      <span className="truncate font-medium">{n.title}</span>
      <Badge tone={n.kind === 'event' ? 'accent' : 'neutral'}>{n.kind === 'event' ? 'event' : 'task'}</Badge>
    </li>
  );
}

/** The next seven days, as bars of how much is due. */
export function WeekCard({ now }: { now: Date }) {
  const today = useTodayMaybe();
  const tz = tzOf();
  const week = useMemo(() => (today ? weekAhead(today.tasks, now, tz) : []), [today, now, tz]);
  if (!today) return null;
  const max = Math.max(1, ...week.map((d) => d.count));
  return (
    <Card title="Week ahead" icon={<CalendarDays size={15} aria-hidden />} href="/today" action="Plan">
      <div
        className="flex h-24 items-end gap-2"
        role="img"
        aria-label={`Tasks due: ${week.map((d) => d.count).join(', ')}`}
      >
        {week.map((d, i) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] tabular-nums text-orv-muted">{d.count || ''}</span>
            <motion.div
              className={cn(
                'w-full rounded-t-md',
                i === 0 ? '[background:var(--orv-accent-grad)]' : 'bg-orv-track',
              )}
              initial={{ height: 4 }}
              animate={{ height: 6 + (d.count / max) * 52 }}
              transition={spring.smooth}
            />
            <span className={cn('text-[11px]', i === 0 ? 'font-semibold text-orv-accent' : 'text-orv-muted')}>
              {new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** This month's spending against what was set aside. */
export function MoneyCard({ now }: { now: Date }) {
  const money = useMoneyMaybe();
  const tz = tzOf();
  const data = useMemo(() => {
    if (!money?.ready) return null;
    const month = monthOf(now.toISOString(), tz);
    const s = summarise(money.transactions, month, tz);
    const overall = budgetProgress(money.budgets, s).find((b) => b.categoryId === null) ?? null;
    const daily = dailySpend(money.transactions, month, tz, Number(localDay(now).slice(8, 10)));
    return { s, overall, daily };
  }, [money, now, tz]);
  if (!money) return null;
  return (
    <Card title="Money" icon={<CircleDollarSign size={15} aria-hidden />} href="/money" testId="dash-money">
      {!data ? (
        <div className="skeleton h-24 rounded-orv-md" />
      ) : (
        <>
          <div>
            <p className="text-display font-semibold tabular-nums" aria-label="Spent this month">
              {formatMoney(data.s.spentMinor)}
            </p>
            <p className="text-small text-orv-muted">
              spent this month
              {data.s.earnedMinor ? ` · ${formatMoney(data.s.earnedMinor)} came in` : ''}
            </p>
          </div>
          <Sparkline values={data.daily.map((d) => d.spentMinor)} label="Spending each day this month" />
          {data.overall ? (
            <div>
              <div className="flex justify-between text-[12px] text-orv-muted">
                <span>Budget</span>
                <span className={cn('tabular-nums', data.overall.ratio > 1 && 'text-orv-danger')}>
                  {formatMoney(data.overall.usedMinor)} / {formatMoney(data.overall.limitMinor)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-orv-track">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, data.overall.ratio * 100)}%`,
                    background:
                      data.overall.ratio > 1
                        ? 'var(--orv-danger)'
                        : data.overall.ratio > 0.8
                          ? 'var(--orv-warning)'
                          : 'var(--orv-accent-grad)',
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-orv-faint">Set a monthly budget in Money to see it here.</p>
          )}
          {money.transactions.filter((t: Transaction) => !t.reviewed).length ? (
            <Link href="/money" className="text-[12px] text-orv-accent">
              {money.transactions.filter((t: Transaction) => !t.reviewed).length} new to check →
            </Link>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** What was dropped and is waiting for a decision. */
export function DropCard() {
  const drop = useDropMaybe();
  if (!drop) return null;
  const waiting = drop.items.filter((i) => i.status === 'proposed');
  const thinking = drop.items.filter((i) => ['new', 'thinking', 'waiting'].includes(i.status)).length;
  return (
    <Card title="Drop" icon={<Inbox size={15} aria-hidden />} href="/drop">
      <p className="text-display font-semibold tabular-nums">{waiting.length}</p>
      <p className="text-small text-orv-muted">
        {waiting.length
          ? `waiting for your yes${thinking ? ` · ${thinking} being read` : ''}`
          : thinking
            ? `${thinking} being read`
            : 'Nothing waiting. Drop anything — a photo, a link, a thought.'}
      </p>
      {waiting.slice(0, 2).map((i) => (
        <p key={i.id} className="truncate rounded-orv-md bg-orv-track px-3 py-2 text-[13px]">
          {(i.proposal && 'title' in i.proposal && i.proposal.title) ||
            i.text ||
            i.url ||
            'Something dropped'}
        </p>
      ))}
    </Card>
  );
}

/** Documents that run out soon (or already have). */
export function ExpiringCard({ now }: { now: Date }) {
  const lib = useLibraryMaybe();
  if (!lib) return null;
  const today = localDay(now);
  const soon = expiringSoon(lib.docs, today, 60).slice(0, 3);
  return (
    <Card
      title="Running out"
      icon={<FileClock size={15} aria-hidden />}
      href="/library"
      action="Library"
      testId="dash-expiring"
    >
      {soon.length ? (
        <ul className="flex flex-col gap-2">
          {soon.map((d) => {
            const e = expiry(d.expiresOn, today);
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="truncate font-medium">{d.title || 'Document'}</span>
                <Badge tone={e.urgency === 'expired' ? 'danger' : 'warning'}>{expiryLabel(e.days)}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-small text-orv-muted">
          {lib.docs.length
            ? 'Nothing runs out in the next two months.'
            : 'Add a document and ORVYN will remind you before it expires.'}
        </p>
      )}
    </Card>
  );
}

/** What needs the person, from the notification centre. */
export function NeedsYouCard() {
  const n = useNotifications();
  return (
    <Card title="Needs you" icon={<Sparkles size={15} aria-hidden />}>
      <div className="-mt-1 flex items-center justify-end">
        {n.unread ? <Badge tone="accent">{n.unread} new</Badge> : null}
      </div>
      {n.items.slice(0, 3).map((i) => (
        <div key={i.id} className="glass-pane p-3">
          <p className="text-[14px] font-semibold">{i.title}</p>
          <p className="line-clamp-2 text-small text-orv-muted">{i.body}</p>
        </div>
      ))}
      {!n.items.length ? (
        <p className="text-small text-orv-muted">Nothing needs you. Enjoy the quiet.</p>
      ) : null}
    </Card>
  );
}

/** Add a task, an expense or a drop without leaving the dashboard. */
export function QuickAddCard() {
  const today = useTodayMaybe();
  const money = useMoneyMaybe();
  const drop = useDropMaybe();
  const toast = useToast();
  const modes = [
    ...(today ? [{ value: 'task', label: 'Task' }] : []),
    ...(money ? [{ value: 'expense', label: 'Expense' }] : []),
    ...(drop ? [{ value: 'drop', label: 'Drop' }] : []),
  ];
  const [mode, setMode] = useState(modes[0]?.value ?? 'task');
  const [text, setText] = useState('');
  useEffect(() => {
    if (modes.length && !modes.some((m) => m.value === mode)) setMode(modes[0]!.value);
  }, [modes, mode]);
  if (!modes.length) return null;
  const spend =
    mode === 'expense' && text.trim() ? parseSpend(text, { now: new Date(), timeZone: tzOf() }) : null;
  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    if (mode === 'task' && today) {
      // the same understanding as Today's quick add: "call mom in 10 min", "pay rent every 1st"
      const fields = taskFields(
        smartParse(t, { timeZone: today.settings?.timeZone, projects: today.projects, literal: [] }),
        localDay(new Date()),
      );
      await today.addTask({ ...fields, title: fields.title || t });
      toast({ title: 'Added to Today', body: fields.title || t, tone: 'success' });
    } else if (mode === 'expense' && money && spend) {
      const { occurredAtFor } = await import('@orvyn/money');
      await money.addTransaction({
        amountMinor: spend.amountMinor,
        direction: spend.direction,
        merchant: spend.merchant,
        note: spend.note,
        categoryId: money.categoryBySlug(spend.category)?.id ?? null,
        occurredAt: occurredAtFor(spend, new Date(), tzOf()).toISOString(),
        source: 'manual',
      });
      toast({
        title: `${spend.direction === 'credit' ? 'Received' : 'Spent'} ${formatMoney(spend.amountMinor)}`,
        tone: 'success',
      });
    } else if (mode === 'drop' && drop) {
      await drop.dropText(t);
      toast({ title: 'Dropped', body: 'ORVYN will read it and ask what to do.', tone: 'success' });
    } else return;
    setText('');
  };
  return (
    <Glass level="float" className="flex flex-col gap-3 p-4" aria-label="Quick add">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-orv-accent">
          <Plus size={15} aria-hidden />
          <Label>Quick add</Label>
        </span>
        {modes.length > 1 ? (
          <Segmented label="Quick add kind" value={mode} onChange={setMode} options={modes} />
        ) : null}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          aria-label="Quick add text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={
            mode === 'task'
              ? 'Call the bank'
              : mode === 'expense'
                ? 'spent 240 on lunch yesterday'
                : 'A link, a thought, something to sort out…'
          }
          className="h-11 flex-1 rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[15px] outline-none placeholder:text-orv-faint"
        />
        <Button type="submit" variant="primary" disabled={!text.trim() || (mode === 'expense' && !spend)}>
          Add
        </Button>
      </form>
      {mode === 'expense' && spend ? (
        <p className="text-[12px] text-orv-accent">
          {formatMoney(spend.amountMinor)}
          {spend.merchant ? ` · ${spend.merchant}` : ''}
          {spend.date ? ` · ${spend.date}` : ''}
        </p>
      ) : null}
    </Glass>
  );
}
