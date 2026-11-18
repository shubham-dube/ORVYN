'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Chrome,
  Laptop,
  Loader2,
  Monitor,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Target {
  id: string;
  channel: 'fcm' | 'webpush';
  active: boolean;
  lastResult: string | null;
  lastError: string | null;
  lastAt: string | null;
}
interface Device {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string | null;
  live: boolean;
  push: Target[];
}
interface Delivery {
  server: { webpush: boolean; fcm: boolean };
  devices: Device[];
}
interface TestResult {
  live: string[];
  push: { deviceId: string; channel: string; outcome: string; detail: string }[];
}

const ICON: Record<string, typeof Laptop> = {
  android: Smartphone,
  ios: Smartphone,
  windows: Monitor,
  extension: Chrome,
  web: Laptop,
};

/** What a device can receive, in words: open now, push, or nothing — and why. */
function status(d: Device): { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string } {
  const active = d.push.filter((t) => t.active);
  const failed = active.find((t) => t.lastResult === 'failed' || t.lastResult === 'skipped');
  if (failed) return { tone: 'danger', text: `Push failing: ${failed.lastError ?? 'unknown reason'}` };
  if (active.some((t) => t.lastResult === 'sent' || t.lastResult === null))
    return { tone: 'success', text: 'Push on — reaches it even when closed' };
  if (d.live) return { tone: 'warning', text: 'Gets notifications only while open' };
  if (d.push.some((t) => !t.active))
    return { tone: 'danger', text: 'Push expired — open ORVYN there to renew it' };
  return {
    tone: 'neutral',
    text: d.platform === 'windows' ? 'Not running — start the tray app' : 'No push set up on this device',
  };
}

/**
 * Your devices, and whether notifications reach each one (spec 0007 A3). A test tries every device now and shows
 * what each push service answered, so "I didn't get it on Windows" has an answer.
 */
export function DeliveryCheck() {
  const { deviceId } = useSession();
  const [d, setD] = useState<Delivery | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const load = useCallback(
    () =>
      api<Delivery>('/notifications/delivery')
        .then(setD)
        .catch(() => setD(null)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const test = async (id: string | null) => {
    setTesting(id ?? 'all');
    try {
      setResult(
        await api<TestResult>('/notifications/test', { method: 'POST', body: id ? { deviceId: id } : {} }),
      );
      await load();
    } finally {
      setTesting(null);
    }
  };

  if (!d) return <div className="skeleton h-24 rounded-orv-md" aria-label="Loading devices" />;
  return (
    <div className="flex flex-col gap-3" data-testid="delivery-check">
      {!d.server.webpush || !d.server.fcm ? (
        <div className="flex items-start gap-2 rounded-orv-md bg-orv-track p-3 text-[13px]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orv-warning" aria-hidden />
          <div>
            {!d.server.webpush ? (
              <p>
                Browser push isn’t set up on the server (VAPID keys). Browsers get notifications only while
                ORVYN is open.
              </p>
            ) : null}
            {!d.server.fcm ? (
              <p>
                Android push isn’t set up on the server (FCM). The phone gets notifications only while the app
                is open.
              </p>
            ) : null}
            <p className="mt-1 text-orv-muted">See docs/guides/notifications.md for the two-minute setup.</p>
          </div>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2" aria-label="Your devices">
        {d.devices.map((dev) => {
          const Icon = ICON[dev.platform] ?? Laptop;
          const s = status(dev);
          const r = result?.push.filter((p) => p.deviceId === dev.id) ?? [];
          const got = result?.live.includes(dev.id);
          return (
            <li key={dev.id} className="flex flex-col gap-1.5 rounded-orv-md border border-orv-edge p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Icon size={16} className="text-orv-accent" aria-hidden />
                <span className="text-[14px] font-medium">{dev.name}</span>
                {dev.id === deviceId ? <Badge tone="accent">this device</Badge> : null}
                {dev.live ? (
                  <Badge tone="success">
                    <Wifi size={11} className="mr-1 inline" aria-hidden />
                    open now
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void test(dev.id)}
                  disabled={!!testing}
                >
                  {testing === dev.id ? <Loader2 size={13} className="animate-spin" /> : null} Test
                </Button>
              </div>
              <p
                className={`text-[12px] ${s.tone === 'danger' ? 'text-orv-danger' : s.tone === 'warning' ? 'text-orv-warning' : s.tone === 'success' ? 'text-orv-success' : 'text-orv-muted'}`}
              >
                {s.text}
              </p>
              {result && (r.length || got !== undefined) ? (
                <p className="text-[12px] text-orv-muted" aria-live="polite">
                  {got ? 'Delivered live just now. ' : ''}
                  {r.map((p) =>
                    p.outcome === 'sent'
                      ? `Pushed via ${p.channel === 'fcm' ? 'Android' : 'browser'} push. `
                      : `${p.channel}: ${p.outcome}${p.detail ? ` — ${p.detail}` : ''}. `,
                  )}
                  {!got && !r.length ? 'Nothing could reach it: it isn’t open and has no push.' : ''}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div>
        <Button variant="secondary" onClick={() => void test(null)} disabled={!!testing}>
          {testing === 'all' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{' '}
          Test every device
        </Button>
      </div>
    </div>
  );
}
