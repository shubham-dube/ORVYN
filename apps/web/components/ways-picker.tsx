'use client';

import { type ContactChannels, REMINDER_WAYS, type ReminderWay, waysOf } from '@orvyn/contracts';
import { AlarmClock, Bell, BellRing, Mail, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/bits';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export const WAY_INFO: Record<
  ReminderWay,
  { label: string; short: string; help: string; icon: typeof Bell }
> = {
  push: {
    label: 'Notification',
    short: 'Notification',
    help: 'A normal notification on your devices.',
    icon: Bell,
  },
  urgent: {
    label: 'Hard notification',
    short: 'Hard',
    help: 'Ignores quiet hours and comes back every 5 minutes until you act on it.',
    icon: BellRing,
  },
  alarm: {
    label: 'Alarm',
    short: 'Alarm',
    help: 'Rings like an alarm — full-screen on Android, even if the app is closed. Other devices show a hard notification.',
    icon: AlarmClock,
  },
  email: { label: 'Email', short: 'Email', help: 'An email to your account address.', icon: Mail },
  whatsapp: {
    label: 'WhatsApp',
    short: 'WhatsApp',
    help: 'A WhatsApp message to your confirmed number.',
    icon: MessageCircle,
  },
};

/** "Notification, Alarm and Email" */
export const waysLabel = (via: readonly ReminderWay[] | undefined | null) => {
  const l = waysOf(via).map((w) => WAY_INFO[w].short);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0]!;
};

let cached: Promise<ContactChannels | null> | null = null;
const loadChannels = () => (cached ??= api<ContactChannels>('/notifications/channels').catch(() => null));
export const refreshChannels = () => {
  cached = null;
  return loadChannels();
};

/** Choose any mix of ways (D22). Nothing chosen counts as a normal notification. */
export function WaysPicker({
  value,
  onChange,
  label = 'How',
  tryable = true,
}: {
  value: readonly ReminderWay[] | undefined;
  onChange(v: ReminderWay[]): void;
  label?: string;
  tryable?: boolean;
}) {
  const toast = useToast();
  const [ch, setCh] = useState<ContactChannels | null>(null);
  useEffect(() => {
    void loadChannels().then(setCh);
  }, []);
  const on = new Set(waysOf(value));
  const toggle = (w: ReminderWay) => {
    const next = new Set(on);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    if (!next.size) next.add('push'); // never nothing
    onChange(REMINDER_WAYS.filter((x) => next.has(x)));
  };
  const needsNumber = on.has('whatsapp') && ch && !ch.whatsapp.verified;
  const unavailable = on.has('whatsapp') && ch && !ch.whatsapp.available;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-[12px] font-semibold uppercase tracking-wide text-orv-faint">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {REMINDER_WAYS.map((w) => {
          const I = WAY_INFO[w].icon;
          const active = on.has(w);
          return (
            <button
              key={w}
              type="button"
              role="checkbox"
              aria-checked={active}
              title={WAY_INFO[w].help}
              onClick={() => toggle(w)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                active
                  ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent'
                  : 'border-orv-edge text-orv-muted hover:text-orv-text',
              )}
            >
              <I size={14} aria-hidden />
              {WAY_INFO[w].label}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-orv-muted">
        {[...on].map((w) => WAY_INFO[w].help).join(' ')}
        {needsNumber && !unavailable ? (
          <>
            {' '}
            <Link href="/settings#notifications" className="text-orv-accent underline">
              Add and confirm your WhatsApp number
            </Link>{' '}
            first.
          </>
        ) : null}
        {unavailable ? ' WhatsApp isn’t set up on this server yet.' : null}
      </p>
      {tryable ? (
        <div>
          <button
            type="button"
            className="text-[12px] font-medium text-orv-accent underline"
            onClick={async () => {
              await api('/notifications/try', { method: 'POST', body: { ways: [...on] } });
              toast({ title: 'Sample sent', body: waysLabel([...on]) });
            }}
          >
            Try it now
          </button>
        </div>
      ) : null}
    </div>
  );
}
