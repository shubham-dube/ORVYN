'use client';

import type { AttentionItem, HomeView } from '@orvyn/contracts';
import { expandEvents } from '@orvyn/today-plan';
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarClock,
  CheckCheck,
  CircleDollarSign,
  FileClock,
  GitPullRequest,
  Hand,
  ListTodo,
  Mail,
  Rocket,
  Sparkles,
  Video,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { SkyIcon } from '@/components/brief';
import { MailRow } from '@/components/inbox';
import { Glass, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useTodayMaybe } from '@/lib/today';

/** Home (spec 0017 A): everything the server knows in one call. */
export function useHome() {
  const [home, setHome] = useState<HomeView | null>(null);
  const load = useCallback(() => api<HomeView>('/home').then(setHome), []);
  useEffect(() => {
    void load().catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);
  return { home, reload: load };
}

const hm = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const mins = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m} min`;
};
const joinUrl = (s: string) =>
  /https:\/\/(meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/\S+/i.exec(s)?.[0] ??
  null;

/** The top: the date, the greeting, the weather, the clock and the Brief's one line. */
export function HomeHero({ now, first, home }: { now: Date; first: string; home: HomeView | null }) {
  const h = now.getHours();
  const hello =
    h < 5
      ? 'Good night'
      : h < 12
        ? 'Good morning'
        : h < 17
          ? 'Good afternoon'
          : h < 22
            ? 'Good evening'
            : 'Good night';
  const w = home?.brief?.weather;
  return (
    <Glass level="float" className="relative overflow-hidden p-6 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[image:var(--orv-accent-grad)] opacity-25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-10 h-56 w-56 rounded-full bg-orv-success opacity-10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-orv-muted">
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-1 text-[32px] font-semibold leading-tight tracking-tight sm:text-[38px]">
            {hello}
            {first ? `, ${first}` : ''}
          </h1>
          {home?.brief?.line ? (
            <Link
              href="/brief"
              className="mt-2 flex max-w-2xl items-start gap-2 text-[15.5px] leading-relaxed text-orv-text/90 hover:text-orv-text"
            >
              <Sparkles size={15} className="mt-1 shrink-0 text-orv-accent" />
              <span>{home.brief.line}</span>
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-[34px] font-semibold leading-none tabular-nums tracking-tight">{hm(now)}</p>
          {w ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-orv-track/70 px-3 py-1 text-[13px]">
              <SkyIcon code={w.code} size={16} className="text-orv-warning" />
              <span className="font-semibold tabular-nums">{w.now ?? w.high}°</span>
              <span className="text-orv-muted">
                {w.sky} · {w.place}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </Glass>
  );
}

/** What's on now (with time left), or the next thing with a countdown — and Join when it has a link. */
export function NowNext({ now }: { now: Date }) {
  const today = useTodayMaybe();
  const v = useMemo(() => {
    if (!today?.ready) return null;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const hidden = new Set(today.calendars.filter((c) => !c.visible).map((c) => c.id));
    const ev = expandEvents(today.events, start, end, hidden).filter((e) => !e.allDay && e.start && e.end);
    const t = now.getTime();
    const current = ev.find((e) => Date.parse(e.start!) <= t && Date.parse(e.end!) > t) ?? null;
    const next = ev.find((e) => Date.parse(e.start!) > t) ?? null;
    const task = today.tasks
      .filter((x) => !x.completedAt && (x.scheduledStart ?? x.dueAt))
      .map((x) => ({ x, at: Date.parse((x.scheduledStart ?? x.dueAt)!) }))
      .filter(({ at }) => at > t && at < end.getTime())
      .sort((a, b) => a.at - b.at)[0];
    return { current, next, task };
  }, [today, now]);
  if (!v || (!v.current && !v.next && !v.task)) return null;
  const tile = (
    label: string,
    title: string,
    sub: string,
    tone: 'live' | 'next' | 'task',
    link: string | null,
  ) => (
    <div
      className={cn(
        'relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-[18px] px-4 py-3',
        tone === 'live' ? 'bg-[color-mix(in_srgb,var(--orv-success)_12%,transparent)]' : 'bg-orv-track/70',
      )}
    >
      <span
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-white',
          tone === 'live'
            ? 'bg-orv-success'
            : tone === 'next'
              ? 'bg-[image:var(--orv-accent-grad)]'
              : 'bg-orv-muted',
        )}
      >
        {tone === 'task' ? <ListTodo size={18} /> : <CalendarClock size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide',
            tone === 'live' ? 'text-orv-success' : 'text-orv-muted',
          )}
        >
          {tone === 'live' ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orv-success" />
          ) : null}
          {label}
        </span>
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-[12.5px] text-orv-muted">{sub}</span>
      </span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer">
          <Button size="sm" variant="primary">
            <Video size={14} /> Join
          </Button>
        </a>
      ) : null}
    </div>
  );
  return (
    <section aria-label="Now and next" className="flex flex-col gap-2 sm:flex-row">
      {v.current
        ? tile(
            'Now',
            v.current.title,
            `ends in ${mins(Date.parse(v.current.end!) - now.getTime())}${v.current.location ? ` · ${v.current.location}` : ''}`,
            'live',
            joinUrl(v.current.location),
          )
        : null}
      {v.next
        ? tile(
            Date.parse(v.next.start!) - now.getTime() < 15 * 60_000 ? 'Starting soon' : 'Next',
            v.next.title,
            `${hm(new Date(v.next.start!))} · in ${mins(Date.parse(v.next.start!) - now.getTime())}`,
            'next',
            Date.parse(v.next.start!) - now.getTime() < 30 * 60_000 ? joinUrl(v.next.location) : null,
          )
        : null}
      {!v.current && v.task
        ? tile(
            'Next task',
            v.task.x.title,
            `${hm(new Date(v.task.at))} · in ${mins(v.task.at - now.getTime())}`,
            'task',
            null,
          )
        : null}
    </section>
  );
}

const KIND_ICON: Record<AttentionItem['kind'], ReactNode> = {
  mail: <Mail size={16} />,
  ipo: <Rocket size={16} />,
  review: <GitPullRequest size={16} />,
  due: <CircleDollarSign size={16} />,
  payments: <Wallet size={16} />,
  overdue: <ListTodo size={16} />,
  expiring: <FileClock size={16} />,
  drop: <ArrowDownToLine size={16} />,
};

/** One ranked list of what waits on me, across every module, each with one tap to act. */
export function NeedsYou({ home, reload }: { home: HomeView | null; reload(): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!home) return <Glass level="pane" className="skeleton h-40" />;
  const items = home.needsYou;
  const act = async (i: AttentionItem) => {
    setBusy(i.id);
    try {
      if (i.kind === 'mail' && i.act?.kind === 'done') {
        await api(`/inbox/items/${i.id.slice(5)}/act`, { method: 'POST', body: { action: 'done' } });
      } else if (i.kind === 'ipo') {
        const decision = i.act?.kind === 'apply' ? 'applying' : 'applied';
        await api(`/ipo/issues/${i.id.slice(4)}/decision`, { method: 'PUT', body: { decision } });
        toast({ title: decision === 'applying' ? 'Added to Today' : 'Marked applied', tone: 'success' });
      }
      reload();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Glass level="pane" as="section" aria-label="Needs you" className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2 px-1 pb-1">
        <Hand size={16} className="text-orv-accent" />
        <h2 className="flex-1 text-[15px] font-semibold">Needs you</h2>
        {items.length ? (
          <span className="text-[12px] text-orv-muted">
            {items.filter((i) => i.urgency === 0).length
              ? `${items.filter((i) => i.urgency === 0).length} today`
              : `${items.length} waiting`}
          </span>
        ) : null}
      </div>
      {!items.length ? (
        <div className="flex items-center gap-3 rounded-[14px] bg-[color-mix(in_srgb,var(--orv-success)_10%,transparent)] px-4 py-4">
          <CheckCheck size={20} className="text-orv-success" />
          <p className="text-[14px]">Nothing is waiting on you. Enjoy the quiet.</p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {items.map((i) => {
            const inner = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-2.5 left-0 top-2.5 w-1 rounded-full',
                    i.urgency === 0 ? 'bg-orv-danger' : i.urgency === 1 ? 'bg-orv-warning' : 'bg-orv-edge',
                  )}
                />
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-[11px]',
                    i.urgency === 0
                      ? 'bg-[color-mix(in_srgb,var(--orv-danger)_12%,transparent)] text-orv-danger'
                      : 'bg-orv-track text-orv-muted',
                  )}
                >
                  {KIND_ICON[i.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{i.title}</span>
                  <span className="block truncate text-[12.5px] text-orv-muted">{i.line}</span>
                </span>
              </>
            );
            return (
              <li
                key={i.id}
                className="group relative flex items-center gap-3 rounded-[14px] py-2 pl-3 pr-1 hover:bg-orv-track/60"
              >
                {i.url ? (
                  <a
                    href={i.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    {inner}
                  </a>
                ) : (
                  <Link href={i.href} className="flex min-w-0 flex-1 items-center gap-3">
                    {inner}
                  </Link>
                )}
                {i.act && i.act.kind !== 'open' ? (
                  <Button
                    size="sm"
                    variant={i.act.kind === 'apply' ? 'primary' : 'ghost'}
                    loading={busy === i.id}
                    onClick={() => void act(i)}
                  >
                    {i.act.kind === 'apply' ? <Hand size={13} /> : <CheckCheck size={13} />} {i.act.label}
                  </Button>
                ) : (
                  <Link
                    href={i.href}
                    aria-label={`Open ${i.title}`}
                    className="grid h-8 w-8 place-items-center rounded-full text-orv-faint group-hover:text-orv-accent"
                  >
                    <ArrowRight size={15} />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {home.more ? <p className="px-2 pt-1 text-[12px] text-orv-muted">and {home.more} more</p> : null}
    </Glass>
  );
}

/** The top of the smart inbox: the catch-up and the three that matter most. */
export function InboxPreview({ home, reload }: { home: HomeView | null; reload(): void }) {
  const ib = home?.inbox;
  if (!ib) return null;
  return (
    <Glass level="pane" as="section" aria-label="Mail" className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2 px-1">
        <Mail size={16} className="text-orv-accent" />
        <h2 className="flex-1 text-[15px] font-semibold">Mail that matters</h2>
        <Link href="/mail" className="text-[12px] text-orv-accent hover:underline">
          {ib.important} important →
        </Link>
      </div>
      {ib.catchUp ? (
        <p className="mx-1 mt-1 flex items-start gap-1.5 rounded-[12px] bg-[color-mix(in_srgb,var(--orv-accent)_8%,transparent)] px-3 py-2 text-[13.5px] leading-relaxed">
          <Sparkles size={13} className="mt-1 shrink-0 text-orv-accent" /> {ib.catchUp}
        </p>
      ) : null}
      <div className="flex flex-col">
        {ib.top.map((m) => (
          <MailRow
            key={m.id}
            m={m}
            accounts={[...new Set(ib.top.map((x) => x.account))]}
            onChanged={reload}
            compact
          />
        ))}
      </div>
    </Glass>
  );
}

/** Open IPOs with their countdown, and the markets. */
export function LiveCard({ home }: { home: HomeView | null }) {
  if (!home || (!home.ipos.length && !home.markets.length)) return null;
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <Glass level="pane" as="section" aria-label="Live" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 px-1">
        <Rocket size={16} className="text-orv-accent" />
        <h2 className="flex-1 text-[15px] font-semibold">Live</h2>
        <Link href="/ipo" className="text-[12px] text-orv-accent hover:underline">
          IPO desk →
        </Link>
      </div>
      {home.markets.length ? (
        <div className="grid grid-cols-2 gap-2">
          {home.markets.map((m) => (
            <div key={m.name} className="rounded-[14px] bg-orv-track/60 px-3 py-2">
              <p className="text-[11.5px] text-orv-muted">{m.name}</p>
              <p className="text-[15px] font-semibold tabular-nums">{m.last.toLocaleString('en-IN')}</p>
              <p
                className={cn(
                  'text-[12px] font-medium tabular-nums',
                  m.changePct >= 0 ? 'text-orv-success' : 'text-orv-danger',
                )}
              >
                {m.changePct >= 0 ? '▲' : '▼'} {Math.abs(m.changePct).toFixed(2)}%
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {home.ipos.map((i) => (
        <Link
          key={i.id}
          href={`/ipo/${i.id}`}
          className="flex items-center gap-3 rounded-[14px] px-1 py-1 hover:bg-orv-track/60"
        >
          {i.logo ? (
            <img
              src={i.logo}
              alt=""
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-[10px] border border-orv-edge bg-white object-contain p-0.5"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[image:var(--orv-accent-grad)] font-semibold text-white">
              {i.name[0]}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{i.name}</span>
            <span className="block text-[12px] text-orv-muted">
              {i.closeDate === today
                ? 'Last day · 5 pm'
                : i.closeDate
                  ? `Closes ${new Date(`${i.closeDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}`
                  : 'Open'}
              {i.gmpPct !== null ? ` · GMP ${i.gmpPct.toFixed(0)}%` : ''}
              {i.decision === 'applying' ? ' · you’ll apply' : i.decision === 'applied' ? ' · applied' : ''}
            </span>
          </span>
          {i.closeDate === today ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-orv-danger" />
          ) : null}
        </Link>
      ))}
    </Glass>
  );
}
