'use client';

import { AiUsage } from '@/components/ai-usage';
import { DeliveryCheck } from '@/components/delivery-check';
import { StorageHealth } from '@/components/storage-health';
import type { ContactChannels, DeviceView, NotifySettings } from '@orvyn/contracts';
import {
  Bell,
  KeyRound,
  Laptop,
  Mail,
  MessageCircle,
  Monitor,
  Moon,
  Smartphone,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { Badge, Glass, Label, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { refreshChannels } from '@/components/ways-picker';
import { cn } from '@/lib/cn';
import { enablePush, pushPermission, pushSupported } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useTodayMaybe } from '@/lib/today';
import { TodaySettings } from '@/components/today-settings';
import { CalendarAccounts } from '@/components/calendar-accounts';
import type { ThemePreference } from '@/lib/theme';

interface PasskeyView {
  id: string;
  name: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="px-1 pt-2 text-title font-semibold">Settings</h1>
      <Profile />
      <Appearance />
      <Notifications />
      <TodaySection />
      <AiSection />
      <StorageSection />
      <Security />
    </div>
  );
}

function StorageSection() {
  const { me } = useSession();
  if (me?.role !== 'owner') return null;
  return (
    <Section id="storage" title="Storage" line="Where files are kept, encrypted. Owner only.">
      <StorageHealth />
    </Section>
  );
}

function AiSection() {
  return (
    <Section
      id="ai"
      title="AI"
      line="What ORVYN's helpers have used. Only counts are shown, never what you asked or what was read."
    >
      <AiUsage />
    </Section>
  );
}

function Section({
  id,
  title,
  line,
  children,
}: {
  id?: string;
  title: string;
  line?: string;
  children: ReactNode;
}) {
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-4 p-5">
      <header id={id} className="scroll-mt-6">
        <h2 className="text-heading font-semibold">{title}</h2>
        {line ? <p className="text-small text-orv-muted">{line}</p> : null}
      </header>
      {children}
    </Glass>
  );
}

function Profile() {
  const { me, refreshMe } = useSession();
  const toast = useToast();
  const [name, setName] = useState(me?.name ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Section title="You" line={me?.email}>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api('/me', { method: 'PATCH', body: { name } });
            await refreshMe();
            toast({ title: 'Saved' });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex-1">
          <Field label="Name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}
          </Field>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!name.trim() || name === me?.name}
        >
          Save
        </Button>
      </form>
    </Section>
  );
}

const PHASES: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'auto', label: 'Follow the sun', icon: <Sparkles size={18} /> },
  { value: 'dawn', label: 'Dawn', icon: <Sunrise size={18} /> },
  { value: 'day', label: 'Day', icon: <Sun size={18} /> },
  { value: 'dusk', label: 'Dusk', icon: <Sunset size={18} /> },
  { value: 'night', label: 'Night', icon: <Moon size={18} /> },
];

function Appearance() {
  const { preference, setPreference, phase } = useTheme();
  return (
    <Section title="Light" line={`ORVYN’s light follows your day. Right now it is ${phase}.`}>
      <div role="radiogroup" aria-label="Light" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PHASES.map((p) => (
          <button
            key={p.value}
            role="radio"
            aria-checked={preference === p.value}
            onClick={() => setPreference(p.value)}
            data-phase-preview={p.value}
            className={cn(
              'flex h-20 flex-col items-center justify-center gap-1.5 rounded-orv-md border text-[13px] font-medium transition-colors',
              preference === p.value
                ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)]'
                : 'border-orv-edge hover:bg-orv-track',
            )}
          >
            <span className={preference === p.value ? 'text-orv-accent' : 'text-orv-muted'}>{p.icon}</span>
            {p.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function Notifications() {
  const toast = useToast();
  const [perm, setPerm] = useState<string>('default');
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  useEffect(() => {
    setPerm(pushPermission());
    void api<NotifySettings>('/notifications/settings').then(setSettings);
  }, []);
  const save = async (s: NotifySettings) => {
    setSettings(s);
    await api('/notifications/settings', { method: 'PUT', body: s });
  };
  const quiet = settings?.quietHours;
  return (
    <Section
      id="notifications"
      title="Notifications"
      line="One notification reaches every device; open or dismiss it anywhere and it clears everywhere."
    >
      <ReachMe />
      <div className="flex flex-wrap items-center gap-3">
        <Bell size={18} className="text-orv-accent" aria-hidden />
        <p className="flex-1 text-[14px]">
          This browser:{' '}
          <strong>
            {perm === 'granted'
              ? 'on'
              : perm === 'denied'
                ? 'blocked in browser settings'
                : perm === 'unsupported'
                  ? 'not supported'
                  : 'off'}
          </strong>
        </p>
        {perm !== 'granted' && pushSupported() ? (
          <Button
            variant="primary"
            onClick={async () => {
              const r = await enablePush();
              setPerm(pushPermission());
              toast({
                title:
                  r === 'enabled'
                    ? 'Notifications on for this browser'
                    : r === 'not_configured'
                      ? 'Push isn’t configured on the server yet'
                      : 'Notifications were not allowed',
                tone: r === 'enabled' ? 'success' : 'danger',
              });
            }}
          >
            Turn on
          </Button>
        ) : null}
      </div>
      <DeliveryCheck />
      {settings ? (
        <div className="flex flex-col gap-3 border-t border-orv-hairline pt-4">
          <Switch
            label="Quiet hours"
            checked={!!quiet}
            onChange={(on) =>
              void save({
                ...settings,
                quietHours: on
                  ? {
                      start: '22:30',
                      end: '07:00',
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    }
                  : null,
              })
            }
          />
          {quiet ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    value={quiet.start}
                    onChange={(e) =>
                      void save({ ...settings, quietHours: { ...quiet, start: e.target.value } })
                    }
                    className="w-36"
                  />
                )}
              </Field>
              <Field label="Until">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    value={quiet.end}
                    onChange={(e) =>
                      void save({ ...settings, quietHours: { ...quiet, end: e.target.value } })
                    }
                    className="w-36"
                  />
                )}
              </Field>
              <p className="pb-3 text-small text-orv-muted">
                Only urgent things break through. ({quiet.timeZone})
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

const PLATFORM_ICON: Record<string, ReactNode> = {
  android: <Smartphone size={18} />,
  ios: <Smartphone size={18} />,
  web: <Monitor size={18} />,
  windows: <Laptop size={18} />,
  macos: <Laptop size={18} />,
  linux: <Laptop size={18} />,
  extension: <Monitor size={18} />,
};

function Security() {
  const { addPasskey } = useSession();
  const toast = useToast();
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [keys, setKeys] = useState<PasskeyView[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const [d, k] = await Promise.all([api<DeviceView[]>('/me/devices'), api<PasskeyView[]>('/me/passkeys')]);
    setDevices(d);
    setKeys(k);
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <Section
      id="security"
      title="Security"
      line="Passkeys are the safest way in — no codes, nothing to phish."
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Passkeys</Label>
          <Button
            size="sm"
            variant="primary"
            loading={adding}
            onClick={async () => {
              setAdding(true);
              try {
                await addPasskey(navigator.platform ? `Passkey on ${navigator.platform}` : 'Passkey');
                toast({ title: 'Passkey added', tone: 'success' });
                await load();
              } catch {
                toast({ title: 'Passkey wasn’t added', tone: 'danger' });
              } finally {
                setAdding(false);
              }
            }}
          >
            <KeyRound size={14} /> Add passkey
          </Button>
        </div>
        {keys.map((k) => (
          <Row
            key={k.id}
            icon={<KeyRound size={18} />}
            title={k.name}
            line={`Added ${new Date(k.createdAt).toLocaleDateString()}${k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ''}`}
            badge={k.backedUp ? <Badge tone="success">synced</Badge> : null}
            onRemove={async () => {
              await api(`/me/passkeys/${k.id}`, { method: 'DELETE' });
              await load();
            }}
            removeLabel={`Remove passkey ${k.name}`}
          />
        ))}
        {!keys.length ? <p className="text-small text-orv-muted">No passkeys yet.</p> : null}
      </div>
      <div className="flex flex-col gap-2 border-t border-orv-hairline pt-4">
        <Label>Signed-in devices</Label>
        {devices.map((d) => (
          <Row
            key={d.id}
            icon={PLATFORM_ICON[d.platform]}
            title={d.name}
            line={`${d.platform} · last seen ${new Date(d.lastSeenAt).toLocaleString()}`}
            badge={d.current ? <Badge tone="accent">this device</Badge> : null}
            onRemove={
              d.current
                ? undefined
                : async () => {
                    await api(`/me/devices/${d.id}`, { method: 'DELETE' });
                    toast({ title: `${d.name} signed out` });
                    await load();
                  }
            }
            removeLabel={`Sign out ${d.name}`}
          />
        ))}
      </div>
    </Section>
  );
}

/** Where reminders can reach me besides the apps (D23). */
function ReachMe() {
  const toast = useToast();
  const [ch, setCh] = useState<ContactChannels | null>(null);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void refreshChannels().then(setCh);
  }, []);
  if (!ch) return null;
  const wa = ch.whatsapp;
  const run = async (fn: () => Promise<ContactChannels['whatsapp']>, ok?: string) => {
    setBusy(true);
    try {
      const w = await fn();
      setCh({ ...ch, whatsapp: w });
      if (ok) toast({ title: ok, tone: 'success' });
      return w;
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'That didn’t work', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" aria-label="Reach me">
      <Label>Reach me by</Label>
      <p className="flex items-center gap-2 text-[14px]">
        <Mail size={16} className="text-orv-accent" aria-hidden /> Email: <strong>{ch.email}</strong>
      </p>
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-[14px]">
          <MessageCircle size={16} className="text-orv-accent" aria-hidden /> WhatsApp:{' '}
          <strong>
            {!wa.available
              ? 'not set up on this server yet'
              : wa.verified
                ? wa.masked
                : wa.masked
                  ? `${wa.masked} (not confirmed)`
                  : 'no number'}
          </strong>
          {wa.verified ? <Badge tone="success">Confirmed</Badge> : null}
        </p>
        {wa.available ? (
          <div className="flex flex-wrap items-end gap-2">
            {!wa.verified && !(wa.masked && sent) ? (
              <>
                <Field label="Your number (with country code)">
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="tel"
                      placeholder="+91 98765 43210"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  loading={busy}
                  disabled={number.trim().length < 6}
                  onClick={async () => {
                    if (await run(() => api('/notifications/whatsapp', { method: 'PUT', body: { number } })))
                      setSent(true);
                  }}
                >
                  Send me a code
                </Button>
              </>
            ) : null}
            {!wa.verified && wa.masked && sent ? (
              <>
                <Field label="The 6-digit code on WhatsApp">
                  {(id) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                  )}
                </Field>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={code.length !== 6}
                  onClick={async () => {
                    await run(
                      () => api('/notifications/whatsapp/verify', { method: 'POST', body: { code } }),
                      'WhatsApp confirmed',
                    );
                    setCode('');
                  }}
                >
                  Confirm
                </Button>
                <Button variant="ghost" onClick={() => setSent(false)}>
                  Use another number
                </Button>
              </>
            ) : null}
            {wa.verified ? (
              <Button
                variant="ghost"
                loading={busy}
                onClick={() =>
                  void run(() => api('/notifications/whatsapp', { method: 'DELETE' }), 'Number removed')
                }
              >
                Remove number
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  icon,
  title,
  line,
  badge,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  title: string;
  line: string;
  badge?: ReactNode;
  onRemove?: () => Promise<void>;
  removeLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="glass-pane flex items-center gap-3 p-3">
      <span className="text-orv-accent" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[14px] font-semibold">
          {title} {badge}
        </p>
        <p className="truncate text-small text-orv-muted">{line}</p>
      </div>
      {onRemove ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={removeLabel}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRemove();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 size={14} />
        </Button>
      ) : null}
    </div>
  );
}

function TodaySection() {
  return useTodayMaybe() ? (
    <>
      <TodaySettings />
      <CalendarAccounts />
    </>
  ) : null;
}
