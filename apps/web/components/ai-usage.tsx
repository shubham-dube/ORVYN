'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/bits';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Usage {
  days: number;
  totalUsd: number;
  byDay: { day: string; costUsd: number; calls: number; failed: number }[];
  byTask: { task: string; model: string; costUsd: number; calls: number }[];
  status: { available: boolean; paused: boolean; capUsd: number; spentTodayUsd: number };
  capUsd?: number;
  todayByPerson?: { ownerId: string | null; person: string; costUsd: number; calls: number }[];
}

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const TASKS: Record<string, string> = {
  'drop.understand': 'Sorting what you drop',
  'today.parse': 'Reading typed tasks',
  'assistant.chat': 'Assistant',
  'library.read': 'Reading documents',
  'money.reply': 'Reading your replies about payments',
};

/** What AI has cost, by day and by job — yours, and (for the owner) everyone's. Never any content. */
export function AiUsage() {
  const { me } = useSession();
  const [u, setU] = useState<Usage | null>(null);
  const [all, setAll] = useState<Usage | null>(null);
  useEffect(() => {
    api<Usage>('/ai/usage?days=14')
      .then(setU)
      .catch(() => setU(null));
    if (me?.role === 'owner')
      api<Usage>('/ai/usage/all?days=14')
        .then(setAll)
        .catch(() => setAll(null));
  }, [me?.role]);
  if (!u) return <div className="skeleton h-24 rounded-orv-md" />;
  const cap = u.status.capUsd;
  const spent = u.status.spentTodayUsd;
  const days = [...u.byDay].reverse();
  const max = Math.max(0.001, ...days.map((d) => d.costUsd));
  return (
    <div className="flex flex-col gap-4" data-testid="ai-usage">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={!u.status.available ? 'neutral' : u.status.paused ? 'warning' : 'success'}>
          {!u.status.available
            ? 'AI is not set up on this server'
            : u.status.paused
              ? 'Paused until tomorrow'
              : 'On'}
        </Badge>
        <p className="text-[14px]">
          Today, everyone together: <strong className="tabular-nums">{usd(spent)}</strong> of{' '}
          <strong className="tabular-nums">{usd(cap)}</strong>. The limit is set on the server; each person
          can use at most half of it.
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-orv-track">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, (spent / Math.max(cap, 0.0001)) * 100)}%`,
            background: u.status.paused ? 'var(--orv-warning)' : 'var(--orv-accent-grad)',
          }}
        />
      </div>
      <div>
        <p className="mb-2 text-small text-orv-muted">
          Your use, last {u.days} days: {usd(u.totalUsd)}
        </p>
        <div className="flex h-16 items-end gap-1" role="img" aria-label="Your AI cost per day">
          {days.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${usd(d.costUsd)}, ${d.calls} calls`}
              className="flex-1 rounded-t [background:var(--orv-accent-grad)]"
              style={{ height: `${Math.max(4, (d.costUsd / max) * 100)}%` }}
            />
          ))}
          {!days.length ? <p className="text-small text-orv-faint">No AI use yet.</p> : null}
        </div>
      </div>
      {u.byTask.length ? (
        <ul className="flex flex-col gap-1 text-[13px]" aria-label="Your AI use by job">
          {u.byTask.map((t) => (
            <li key={t.task + t.model} className="flex justify-between gap-3">
              <span className="truncate">
                {TASKS[t.task] ?? t.task}
                {t.model === 'cache' ? (
                  <span className="text-orv-success"> · answered from memory, free</span>
                ) : t.model.includes('fable') ? (
                  <span className="text-orv-muted"> · stronger model, when unsure</span>
                ) : null}
              </span>
              <span className="tabular-nums text-orv-muted">
                {t.calls} calls · {usd(t.costUsd)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {all?.todayByPerson ? (
        <div className="border-t border-orv-edge pt-3">
          <p className="mb-1 text-[13px] font-semibold">Everyone today (owner)</p>
          <ul className="flex flex-col gap-1 text-[13px]" aria-label="AI use today by person">
            {all.todayByPerson.map((p) => (
              <li key={p.ownerId ?? 'system'} className="flex justify-between gap-3">
                <span className="truncate">{p.person}</span>
                <span className="tabular-nums text-orv-muted">
                  {p.calls} calls · {usd(p.costUsd)}
                </span>
              </li>
            ))}
            {!all.todayByPerson.length ? <li className="text-orv-muted">Nobody has used AI today.</li> : null}
          </ul>
          <p className="mt-2 text-[12px] text-orv-faint">
            Last {all.days} days, all together: {usd(all.totalUsd)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
