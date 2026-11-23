'use client';

import type { IpoIssueView } from '@orvyn/contracts';
import { ExternalLink, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AddIssueSheet, type FeedInfo, IpoSettingsSheet, IssueCard, NotifyButton } from '@/components/ipo';
import { PoolOverview } from '@/components/pool';
import { Glass, Segmented, SkeletonCards } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type When = 'current' | 'closed' | 'listed';

type Show = 'mainboard' | 'sme' | 'all';

function Desk() {
  const [when, setWhen] = useState<When>('current');
  // null until the server says what this person chose last (mainboard first — spec 0016 A1)
  const [show, setShow] = useState<Show | null>(null);
  const [data, setData] = useState<{ issues: IpoIssueView[]; feed: FeedInfo; show: Show } | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () =>
      api<{ issues: IpoIssueView[]; feed: FeedInfo; show: Show }>(
        `/ipo/issues?when=${when}${show ? `&type=${show}` : ''}`,
      ).then((r) => {
        setData(r);
        setShow((s) => s ?? r.show);
      }),
    [when, show],
  );
  useEffect(() => void load().catch(() => undefined), [load]);
  const pick = async (v: Show) => {
    setShow(v);
    // remembered on every device: SME on or off
    const s = await api<Record<string, unknown>>('/ipo/settings');
    if (Boolean(s.showSme) !== (v !== 'mainboard'))
      await api('/ipo/settings', { method: 'PUT', body: { ...s, showSme: v !== 'mainboard' } });
  };
  const closingToday =
    data?.issues.filter(
      (i) => i.status === 'open' && i.closeDate === new Date().toLocaleDateString('en-CA'),
    ) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Which IPOs"
          value={when}
          onChange={(v) => setWhen(v as When)}
          options={[
            { value: 'current', label: 'Open & upcoming' },
            { value: 'closed', label: 'Awaiting listing' },
            { value: 'listed', label: 'Listed' },
          ]}
        />
        <Segmented
          label="Mainboard or SME"
          value={show ?? 'mainboard'}
          onChange={(v) => void pick(v as Show)}
          options={[
            { value: 'mainboard', label: 'Mainboard' },
            { value: 'sme', label: 'SME' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="flex-1" />
        <NotifyButton onClick={() => setSettings(true)} />
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add by hand
        </Button>
      </div>
      {data && !data.feed.ready ? (
        <Glass level="pane" className="p-4 text-[13.5px]">
          No market feed is connected yet, so figures are typed in by hand. Set <code>IPO_FEED=ipoguru</code>{' '}
          and <code>IPO_FEED_KEY</code> on the server for the calendar and GMP to arrive on their own.
        </Glass>
      ) : null}
      {closingToday.length ? (
        <div className="flex items-center gap-2 rounded-orv-md bg-[color-mix(in_srgb,var(--orv-danger)_10%,transparent)] px-4 py-2.5 text-[13.5px]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orv-danger" />
          <span className="font-semibold">Last day:</span> {closingToday.map((i) => i.name).join(', ')} — bids
          close at 5 pm.
        </div>
      ) : null}
      {data === null ? (
        <SkeletonCards count={4} label="Loading IPOs" />
      ) : !data.issues.length ? (
        <p className="px-1 text-small text-orv-muted">Nothing here right now.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.issues.map((i) => (
            <IssueCard key={i.id} i={i} onChange={() => void load()} />
          ))}
        </div>
      )}
      {data?.feed.credit ? (
        <p className="px-1 text-[12px] text-orv-faint">
          Data:{' '}
          <a className="underline" href={data.feed.credit} target="_blank" rel="noreferrer">
            {data.feed.name} <ExternalLink size={10} className="inline" />
          </a>{' '}
          · GMP is unofficial · not investment advice
        </p>
      ) : null}
      <IpoSettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        onSaved={() => {
          setShow(null);
          void load();
        }}
      />
      <AddIssueSheet open={adding} onClose={() => setAdding(false)} onAdded={() => void load()} />
    </div>
  );
}

function Inner() {
  const q = useSearchParams();
  const router = useRouter();
  const tab = q.get('tab') === 'pool' ? 'pool' : 'desk';
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">India · GMP, demand, odds — and what you’ll do</span>
          <h1 className="text-title font-semibold">IPO desk</h1>
        </div>
        <Segmented
          label="Desk or Pool"
          value={tab}
          onChange={(v) => router.replace(v === 'pool' ? '/ipo?tab=pool' : '/ipo')}
          options={[
            { value: 'desk', label: 'Desk' },
            { value: 'pool', label: 'My Pool' },
          ]}
        />
      </header>
      {tab === 'pool' ? <PoolOverview /> : <Desk />}
    </div>
  );
}

/** The IPO desk and the IPO Pool (spec 0010). */
export default function IpoPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
