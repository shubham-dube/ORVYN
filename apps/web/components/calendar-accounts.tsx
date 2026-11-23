'use client';

import { PROJECT_COLOURS } from '@orvyn/contracts';
import { CalendarDays, EyeOff, Plus, RefreshCw, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Glass, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useToday } from '@/lib/today';
import { HOLIDAYS } from './schedule';

interface Account {
  id: string;
  provider: string;
  email: string;
  status: 'active' | 'needs_reconnect';
  lastSyncedAt: string | null;
}

const RESULT: Record<string, { title: string; tone: 'success' | 'danger' }> = {
  connected: { title: 'Google Calendar connected', tone: 'success' },
  cancelled: { title: 'Nothing was connected', tone: 'danger' },
  expired: { title: 'That took too long — please try again', tone: 'danger' },
  failed: { title: 'Google Calendar couldn’t be connected', tone: 'danger' },
  no_offline_access: { title: 'Google didn’t allow offline access — please try again', tone: 'danger' },
};

/** Settings → Calendars (D15): any number of Google accounts, each calendar shown/hidden and coloured. */
export function CalendarAccounts() {
  const { calendars, saveCalendar } = useToday();
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setAccounts(await api<Account[]>('/calendar/accounts')), []);
  useEffect(() => {
    void load().catch(() => setAccounts([]));
    // back from Google: say how it went, once
    const p = new URLSearchParams(window.location.search);
    const r = p.get('calendar');
    if (r && RESULT[r]) {
      toast(RESULT[r]);
      p.delete('calendar');
      window.history.replaceState(null, '', `${window.location.pathname}${p.size ? `?${p}` : ''}#calendars`);
    }
  }, [load, toast]);

  const connect = async (hint?: string) => {
    setBusy('connect');
    try {
      const { url } = await api<{ url: string }>(
        `/calendar/google/start${hint ? `?hint=${encodeURIComponent(hint)}` : ''}`,
        { method: 'POST' },
      );
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      toast({
        title:
          e instanceof ApiError && e.code === 'google_not_configured'
            ? 'Google Calendar isn’t set up on this server yet'
            : 'Couldn’t start connecting',
        tone: 'danger',
      });
    }
  };

  return (
    <Glass level="pane" as="section" className="flex flex-col gap-4 p-5">
      <header id="calendars" className="scroll-mt-6">
        <h2 className="text-heading font-semibold">Calendars</h2>
        <p className="text-small text-orv-muted">
          Connect as many Google accounts as you use. Changes go both ways; pick which calendars show.
        </p>
      </header>
      {accounts === null ? (
        <div className="skeleton h-12 rounded-orv-md" />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Connected accounts">
          {accounts.map((a) => {
            const mine = calendars.filter((c) => c.accountId === a.id);
            return (
              <li key={a.id} className="glass-pane flex flex-col gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarDays size={16} aria-hidden className="text-orv-accent" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{a.email}</span>
                  {a.status === 'needs_reconnect' ? (
                    <>
                      <Badge tone="danger">Needs reconnecting</Badge>
                      <Button size="sm" onClick={() => void connect(a.email)} loading={busy === 'connect'}>
                        Reconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Sync ${a.email} now`}
                      loading={busy === `sync-${a.id}`}
                      onClick={async () => {
                        setBusy(`sync-${a.id}`);
                        await api(`/calendar/accounts/${a.id}/sync`, { method: 'POST' }).catch(
                          () => undefined,
                        );
                        await load();
                        setBusy(null);
                      }}
                    >
                      <RefreshCw size={14} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Disconnect ${a.email}`}
                    loading={busy === `off-${a.id}`}
                    onClick={async () => {
                      if (
                        !window.confirm(`Disconnect ${a.email}? Its calendars leave ORVYN on every device.`)
                      )
                        return;
                      setBusy(`off-${a.id}`);
                      await api(`/calendar/accounts/${a.id}`, { method: 'DELETE' });
                      await load();
                      setBusy(null);
                      toast({ title: 'Disconnected', body: a.email });
                    }}
                  >
                    <Unplug size={14} />
                  </Button>
                </div>
                <ul className="flex flex-col gap-2" aria-label={`Calendars in ${a.email}`}>
                  {mine.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 pl-6">
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-full"
                        style={{ background: `var(--orv-label-${c.colour})` }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px]">
                        {c.name}
                        {!c.writable ? <span className="text-orv-faint"> · view only</span> : null}
                      </span>
                      <div className="flex gap-1" role="radiogroup" aria-label={`Colour of ${c.name}`}>
                        {PROJECT_COLOURS.map((k) => (
                          <button
                            key={k}
                            role="radio"
                            aria-checked={c.colour === k}
                            aria-label={k}
                            onClick={() => void saveCalendar(c.id, { colour: k })}
                            className="h-4 w-4 rounded-full border-2"
                            style={{
                              background: `var(--orv-label-${k})`,
                              borderColor: c.colour === k ? 'var(--orv-text)' : 'transparent',
                            }}
                          />
                        ))}
                      </div>
                      <Switch
                        checked={c.visible}
                        onChange={(v) => void saveCalendar(c.id, { visible: v })}
                        label={`Show ${c.name}`}
                      />
                    </li>
                  ))}
                  {!mine.length ? (
                    <li className="pl-6 text-small text-orv-muted">Fetching calendars…</li>
                  ) : null}
                </ul>
                {a.lastSyncedAt ? (
                  <p className="pl-6 text-[11px] text-orv-faint">
                    Last synced {new Date(a.lastSyncedAt).toLocaleString()}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {calendars.some((c) => c.visible && HOLIDAYS.test(c.externalId ?? '')) ? (
          <Button
            variant="ghost"
            onClick={async () => {
              for (const c of calendars.filter((c) => c.visible && HOLIDAYS.test(c.externalId ?? '')))
                await saveCalendar(c.id, { visible: false });
            }}
          >
            <EyeOff size={14} /> Hide public holidays
          </Button>
        ) : null}
        <Button onClick={() => void connect()} loading={busy === 'connect'}>
          <Plus size={14} />{' '}
          {accounts?.length ? 'Connect another Google account' : 'Connect a Google account'}
        </Button>
      </div>
    </Glass>
  );
}
