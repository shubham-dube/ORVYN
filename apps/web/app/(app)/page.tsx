'use client';

import { MODULE_KEYS } from '@orvyn/contracts';
import { useEffect, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { Badge, Glass, Label } from '@/components/ui/bits';
import { useNotifications } from '@/lib/notifications';
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
const MODULE_INFO: Record<string, { name: string; line: string }> = {
  today: { name: 'Today', line: 'Tasks and calendar on one river of time' },
  drop: { name: 'Drop', line: 'Photograph, say or forward anything — it files itself' },
  money: { name: 'Money', line: 'Spending captured from SMS, receipts and statements' },
  library: { name: 'Library', line: 'Documents that organise themselves' },
  vault: { name: 'Vault', line: 'Secrets only your devices can open' },
  assistant: { name: 'Assistant', line: 'Ask anything about your life, and act on it' },
  chat: { name: 'Chat', line: 'End-to-end encrypted conversations with friends' },
  ipo: { name: 'IPO desk', line: 'Every Indian IPO, read and reasoned for you' },
  jobs: { name: 'Jobs', line: 'JobOS reviews and applications from your phone' },
};

export default function Home() {
  const { me } = useSession();
  const { phase } = useTheme();
  const n = useNotifications();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const first = (me?.name || '').split(' ')[0];
  const coming = MODULE_KEYS.filter((k) => me?.entitlements.includes(k));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 px-1 pt-2">
        <span className="text-small text-orv-muted">
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <h1 className="text-title font-semibold">
          {greeting(now)}
          {first ? `, ${first}` : ''}
        </h1>
      </header>

      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <Glass level="float" className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-orv-accent"
              style={{ animation: 'orv-dot 2.4s ease-in-out infinite' }}
            />
            <Label>Now</Label>
          </div>
          <p className="tabular text-display font-semibold">
            {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-small text-orv-muted">
            The light follows your day — it is {phase} now. Today, your timeline of tasks and events, arrives
            next and will live right here.
          </p>
        </Glass>

        <Glass level="float" className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <Label>Needs you</Label>
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
        </Glass>
      </div>

      <Glass level="pane" className="p-5">
        <Label className="mb-3 block">Your ORVYN</Label>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {coming.map((k) => (
            <li key={k} data-module={k} className="glass-pane flex items-start gap-3 p-3">
              <span
                aria-hidden
                className="mt-0.5 h-8 w-8 shrink-0 rounded-[10px] [background:var(--orv-accent-grad)]"
              />
              <div>
                <p className="flex items-center gap-2 text-[14px] font-semibold">
                  {MODULE_INFO[k]?.name}
                  <Badge>soon</Badge>
                </p>
                <p className="text-small text-orv-muted">{MODULE_INFO[k]?.line}</p>
              </div>
            </li>
          ))}
        </ul>
      </Glass>
    </div>
  );
}
