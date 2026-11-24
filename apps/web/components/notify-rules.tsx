'use client';

import type {
  ContactChannels,
  NotifyRule,
  NotifySettings,
  NotifyTypeInfo,
  NotifyWay,
} from '@orvyn/contracts';
import { AlarmClock, Bell, ChevronDown, Mail, MessageCircle, Siren, Send } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { groups, ruleOf, summary, toggle } from '@/lib/notify-rules';
import { useSession } from '@/lib/session';

const WAY: Record<NotifyWay, { label: string; icon: ReactNode; hint: string }> = {
  push: { label: 'Push', icon: <Bell size={13} />, hint: 'Phone shade and browser' },
  urgent: { label: 'Urgent', icon: <Siren size={13} />, hint: 'Through quiet hours; comes back until seen' },
  alarm: { label: 'Alarm', icon: <AlarmClock size={13} />, hint: 'Rings the phone like an alarm' },
  email: { label: 'Email', icon: <Mail size={13} />, hint: 'A copy to your email' },
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle size={13} />, hint: 'A copy to your confirmed number' },
};

/**
 * Every notification ORVYN sends, by module, each with its own ways (spec 0019): on or off, push, urgent, alarm,
 * email, WhatsApp — and a sample to see how it lands.
 */
export function NotifyRules({
  settings,
  onSave,
}: {
  settings: NotifySettings;
  onSave(s: NotifySettings): Promise<void>;
}) {
  const { me } = useSession();
  const toast = useToast();
  const [channels, setChannels] = useState<ContactChannels | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void api<ContactChannels>('/notifications/channels').then(setChannels, () => undefined);
  }, []);
  const can = (m: string) => me?.role === 'owner' || !!me?.entitlements.includes(m as never);
  const rules = settings.rules ?? {};
  const set = (t: NotifyTypeInfo, r: NotifyRule) =>
    void onSave({ ...settings, rules: { ...rules, [t.key]: r } });
  const waOk = !!channels?.whatsapp.verified;
  return (
    <div className="flex flex-col gap-2 border-t border-orv-hairline pt-4">
      <div>
        <h3 className="text-[15px] font-semibold">What reaches you, and how</h3>
        <p className="text-small text-orv-muted">
          Everything lands in the bell. Choose more for each kind — or switch it off.
        </p>
      </div>
      {groups(can).map((g) => (
        <div key={g.module} className="overflow-hidden rounded-orv-md border border-orv-edge">
          <button
            type="button"
            aria-expanded={open === g.module}
            onClick={() => setOpen(open === g.module ? null : g.module)}
            className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-orv-track/60"
          >
            <span className="flex-1 text-[14.5px] font-semibold">{g.name}</span>
            <span className="truncate text-[12.5px] text-orv-muted">
              {g.types.length} {g.types.length === 1 ? 'kind' : 'kinds'}
            </span>
            <ChevronDown
              size={16}
              className={cn('text-orv-muted transition-transform', open === g.module && 'rotate-180')}
            />
          </button>
          {open === g.module ? (
            <ul className="divide-y divide-orv-hairline border-t border-orv-hairline">
              {g.types.map((t) => {
                const r = ruleOf(t, rules);
                return (
                  <li key={t.key} className="flex flex-col gap-2 px-3.5 py-3" aria-label={t.label}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">{t.label}</p>
                        <p className="text-[12.5px] text-orv-muted">{t.when}</p>
                      </div>
                      {t.managedIn ? null : (
                        <Switch
                          label={`${t.label} on`}
                          checked={r.on}
                          disabled={t.locked}
                          onChange={(on) => set(t, { ...r, on })}
                        />
                      )}
                    </div>
                    {t.managedIn ? (
                      <p className="text-[12.5px]">
                        Set on each item —{' '}
                        <Link href={t.managedIn.href} className="text-orv-accent hover:underline">
                          {t.managedIn.label}
                        </Link>
                      </p>
                    ) : r.on ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(['push', 'urgent', 'alarm', 'email', 'whatsapp'] as NotifyWay[])
                          .filter((w) => w !== 'alarm' || t.alarm)
                          .map((w) => {
                            const on = r.ways.includes(w);
                            const off = w === 'whatsapp' && !waOk && !on;
                            return (
                              <button
                                key={w}
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                disabled={off}
                                title={off ? 'Confirm a WhatsApp number above first' : WAY[w].hint}
                                onClick={() => set(t, toggle(r, w))}
                                className={cn(
                                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors disabled:opacity-40',
                                  on
                                    ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] font-medium text-orv-accent'
                                    : 'border-orv-edge text-orv-muted hover:bg-orv-track',
                                )}
                              >
                                {WAY[w].icon}
                                {WAY[w].label}
                              </button>
                            );
                          })}
                        <span className="ml-1 text-[12px] text-orv-faint">{summary(r)}</span>
                        <div className="flex-1" />
                        {rules[t.key] ? (
                          <button
                            type="button"
                            className="text-[12px] text-orv-muted hover:text-orv-text"
                            onClick={() => {
                              const { [t.key]: _, ...rest } = rules;
                              void onSave({ ...settings, rules: rest });
                            }}
                          >
                            Default
                          </button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await api('/notifications/sample', { method: 'POST', body: { type: t.key } });
                              toast({ title: 'Sample sent', tone: 'success' });
                            } catch (e) {
                              toast({
                                title: e instanceof ApiError ? e.message : 'Couldn’t send',
                                tone: 'danger',
                              });
                            }
                          }}
                        >
                          <Send size={13} /> Sample
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-orv-muted">
                        Off — nothing is sent, not even to the bell.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
