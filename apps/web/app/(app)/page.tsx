'use client';

import { BriefCard } from '@/components/brief';
import { MailCard } from '@/components/tools';

import { MODULE_KEYS } from '@orvyn/contracts';
import { useTodayMaybe } from '@/lib/today';
import {
  Bot,
  BookOpen,
  BriefcaseBusiness,
  CircleDollarSign,
  Inbox,
  KeyRound,
  ListTodo,
  type LucideIcon,
  MessagesSquare,
  Sunrise,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DropCard,
  ExpiringCard,
  MoneyCard,
  NeedsYouCard,
  QuickAddCard,
  TodayCard,
  WeekCard,
} from '@/components/dashboard';
import { useTheme } from '@/components/theme-provider';
import { Badge, Label } from '@/components/ui/bits';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

/** By the clock, not the light — someone who pins Night at noon still gets "Good afternoon". */
function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5
    ? 'Good night'
    : h < 12
      ? 'Good morning'
      : h < 17
        ? 'Good afternoon'
        : h < 22
          ? 'Good evening'
          : 'Good night';
}

const MODULE_INFO: Record<string, { name: string; line: string; icon: LucideIcon; href: string }> = {
  today: { name: 'Today', line: 'Tasks and calendar on one river of time', icon: ListTodo, href: '/today' },
  drop: {
    name: 'Drop',
    line: 'Photograph, say or forward anything — it files itself',
    icon: Inbox,
    href: '/drop',
  },
  money: {
    name: 'Money',
    line: 'Spending captured from SMS, receipts and statements',
    icon: CircleDollarSign,
    href: '/money',
  },
  library: { name: 'Library', line: 'Documents that organise themselves', icon: BookOpen, href: '/library' },
  vault: { name: 'Vault', line: 'Secrets only your devices can open', icon: KeyRound, href: '/vault' },
  assistant: {
    name: 'Assistant',
    line: 'Ask anything about your life, and act on it',
    icon: Bot,
    href: '/assistant',
  },
  brief: { name: 'Brief', line: 'Your morning in one look, and quiet nudges', icon: Sunrise, href: '/brief' },
  chat: {
    name: 'Chat',
    line: 'End-to-end encrypted conversations with friends',
    icon: MessagesSquare,
    href: '/chat',
  },
  ipo: {
    name: 'IPO desk',
    line: 'Every Indian IPO, read and reasoned for you',
    icon: TrendingUp,
    href: '/ipo',
  },
  jobs: {
    name: 'Jobs',
    line: 'JobOS reviews and applications from your phone',
    icon: BriefcaseBusiness,
    href: '/jobs',
  },
};
/** Modules that are built; the rest show as "soon". */
const BUILT = new Set(['today', 'drop', 'money', 'library', 'vault', 'assistant', 'brief']);

export default function Home() {
  const { me } = useSession();
  const { phase } = useTheme();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const first = (me?.name || '').split(' ')[0];
  const mine = MODULE_KEYS.filter((k) => me?.role === 'owner' || me?.entitlements.includes(k));
  const hasToday = !!useTodayMaybe();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div className="flex flex-col gap-1">
          <span className="text-small text-orv-muted">
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1 className="text-title font-semibold">
            {greeting(now)}
            {first ? `, ${first}` : ''}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-small text-orv-muted">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-orv-accent"
            style={{ animation: 'orv-dot 2.4s ease-in-out infinite' }}
          />
          <span className="tabular-nums">
            {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span>· {phase}</span>
        </div>
      </header>

      <QuickAddCard />

      <div className="grid gap-4 md:grid-cols-3">
        {me?.role === 'owner' || me?.entitlements.includes('brief') ? <BriefCard /> : null}
        {hasToday ? <TodayCard now={now} /> : null}
        <NeedsYouCard />
        <MoneyCard now={now} />
        <WeekCard now={now} />
        <DropCard />
        <ExpiringCard now={now} />
        <MailCard />
      </div>

      <section aria-label="Your ORVYN">
        <Label className="mb-3 block px-1">Your ORVYN</Label>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((k) => {
            const info = MODULE_INFO[k];
            if (!info) return null;
            const built = BUILT.has(k);
            const Icon = info.icon;
            const body = (
              <>
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-white [background:var(--orv-accent-grad)]"
                >
                  <Icon size={19} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    {info.name}
                    {built ? null : <Badge>soon</Badge>}
                  </span>
                  <span className="block text-small text-orv-muted">{info.line}</span>
                </span>
              </>
            );
            return (
              <li key={k} data-module={k}>
                {built ? (
                  <Link
                    href={info.href}
                    className={cn(
                      'glass-pane flex items-start gap-3 p-3 transition-transform hover:-translate-y-0.5',
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="glass-pane flex items-start gap-3 p-3 opacity-80">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
