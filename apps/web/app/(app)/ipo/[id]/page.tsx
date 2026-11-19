'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { type IssueDetail, IssueDetailView } from '@/components/ipo';
import { StartRoundSheet } from '@/components/pool';
import { SkeletonCards } from '@/components/ui/bits';
import { api } from '@/lib/api';

export default function IpoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<IssueDetail | null>(null);
  const [round, setRound] = useState(false);
  const load = useCallback(() => api<IssueDetail>(`/ipo/issues/${id}`).then(setD), [id]);
  useEffect(() => void load().catch(() => undefined), [load]);
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/ipo"
        className="inline-flex items-center gap-1 px-1 text-[13px] text-orv-muted hover:text-orv-text"
      >
        <ArrowLeft size={14} /> All IPOs
      </Link>
      {d ? (
        <IssueDetailView d={d} onChange={() => void load()} onStartRound={() => setRound(true)} />
      ) : (
        <SkeletonCards count={3} label="Loading the IPO" />
      )}
      {round && d ? (
        <StartRoundSheet
          issueId={d.id}
          issueName={d.name}
          onClose={() => setRound(false)}
          onStarted={(rid) => router.push(`/ipo/pool/rounds/${rid}`)}
        />
      ) : null}
    </div>
  );
}
