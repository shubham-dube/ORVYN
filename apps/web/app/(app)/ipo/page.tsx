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

function Desk() {
  const [when, setWhen] = useState<When>('current');
  const [data, setData] = useState<{ issues: IpoIssueView[]; feed: FeedInfo } | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () => api<{ issues: IpoIssueView[]; feed: FeedInfo }>(`/ipo/issues?when=${when}`).then(setData),
    [when],
  );
  useEffect(() => void load().catch(() => undefined), [load]);
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
      {data === null ? (
        <SkeletonCards count={4} label="Loading IPOs" />
      ) : !data.issues.length ? (
        <p className="px-1 text-small text-orv-muted">Nothing here right now.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.issues.map((i) => (
            <IssueCard key={i.id} i={i} onStar={() => void load()} />
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
      <IpoSettingsSheet open={settings} onClose={() => setSettings(false)} />
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
          <span className="text-small text-orv-muted">India · mainboard and SME</span>
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
