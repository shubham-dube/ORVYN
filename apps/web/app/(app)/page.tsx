'use client';

import { HomeHero, InboxPreview, LiveCard, NeedsYou, NowNext, useHome } from '@/components/home';

import { MODULE_KEYS } from '@orvyn/contracts';
import { useTodayMaybe } from '@/lib/today';
import {
  Bot,
  BookOpen,
  BriefcaseBusiness,
  CircleDollarSign,
  Inbox,
  KeyRound,
  Mail,
  ListTodo,
  type LucideIcon,
  MessagesSquare,
  Receipt,
  Sunrise,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MoneyCard, QuickAddCard, TodayCard, WeekCard } from '@/components/dashboard';
import { Label } from '@/components/ui/bits';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

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
  split: { name: 'Split', line: 'Trips and parties: who paid, who owes', icon: Receipt, href: '/split' },
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
const BUILT = new Set([
  'today',
  'drop',
  'money',
  'library',
  'vault',
  'assistant',
  'brief',
  'ipo',
  'chat',
  'split',
]);

/**
 * Home (spec 0017 A), mission control: the hero, now & next, what needs me across everything, today, money, the mail
 * that matters, the week and what's live — then everything else as a compact grid.
 */
export default function Home() {
  const { me } = useSession();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const { home, reload } = useHome();
  const first = (me?.name || '').split(' ')[0] ?? '';
  const mine = MODULE_KEYS.filter((k) => me?.role === 'owner' || me?.entitlements.includes(k));
  const hasToday = !!useTodayMaybe();

  return (
    <div className="flex flex-col gap-4">
      <HomeHero now={now} first={first} home={home} />
      {hasToday ? <NowNext now={now} /> : null}
      <QuickAddCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <NeedsYou home={home} reload={() => void reload()} />
          {hasToday ? <TodayCard now={now} /> : null}
          <InboxPreview home={home} reload={() => void reload()} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <MoneyCard now={now} />
          <LiveCard home={home} />
          {hasToday ? <WeekCard now={now} /> : null}
        </div>
      </div>

      <section aria-label="Your ORVYN" className="pt-2">
        <Label className="mb-3 block px-1">Everything else</Label>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {mine.map((k) => {
            const info = MODULE_INFO[k];
            if (!info || !BUILT.has(k)) return null;
            const Icon = info.icon;
            return (
              <li key={k} data-module={k}>
                <Link
                  href={info.href}
                  title={info.line}
                  className={cn(
                    'glass-pane flex flex-col items-center gap-2 px-2 py-4 text-center transition-transform hover:-translate-y-0.5',
                  )}
                >
                  <span
                    aria-hidden
                    className="grid h-11 w-11 place-items-center rounded-[14px] text-white [background:var(--orv-accent-grad)]"
                  >
                    <Icon size={20} />
                  </span>
                  <span className="text-[13px] font-semibold">{info.name}</span>
                </Link>
              </li>
            );
          })}
          {mine.includes('today') ? (
            <li>
              <Link
                href="/mail"
                className="glass-pane flex flex-col items-center gap-2 px-2 py-4 text-center transition-transform hover:-translate-y-0.5"
              >
                <span
                  aria-hidden
                  className="grid h-11 w-11 place-items-center rounded-[14px] text-white [background:var(--orv-accent-grad)]"
                >
                  <Mail size={20} />
                </span>
                <span className="text-[13px] font-semibold">Mail</span>
              </Link>
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
