'use client';

import {
  BellRing,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Eye,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hourglass,
  Loader,
  MessageSquareWarning,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { type GitHubItem, invalidate, type Pr, prSummary, useCached } from '@/lib/work';
import { useConnectionsCached } from './clickup';
import { ProviderMark } from './connections';

const age = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`;
};

function useGitHub() {
  const conns = useConnectionsCached();
  const has = !!conns.data?.some((c) => c.provider === 'github');
  const prs = useCached<Pr[]>('github.prs', has ? '/connections/github/prs' : null, 2 * 60_000);
  const work = useCached<GitHubItem[]>('github.work', has ? '/connections/github/work' : null, 2 * 60_000);
  return { has, known: conns.data !== undefined, prs, work };
}

export function PrRow({
  pr,
  review,
}: {
  pr: Partial<Pr> & Pick<Pr, 'title' | 'url' | 'repo' | 'number'>;
  review?: boolean;
}) {
  const state = pr.state ?? 'open';
  const [Icon, tone] =
    state === 'merged'
      ? [GitMerge, '#8b5cf6']
      : state === 'closed'
        ? [GitPullRequestClosed, 'var(--orv-faint)']
        : pr.draft
          ? [GitPullRequestDraft, 'var(--orv-faint)']
          : [GitPullRequest, 'var(--orv-success)'];
  const when = state === 'open' ? pr.updatedAt : (pr.closedAt ?? pr.updatedAt);
  return (
    <li>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-start gap-3 rounded-orv-md px-1.5 py-2.5 hover:bg-orv-track"
      >
        <Icon size={18} className="mt-0.5 shrink-0" style={{ color: tone }} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-[15px] font-medium">{pr.title}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-orv-muted">
            <span className="font-mono">
              {pr.repo} #{pr.number}
            </span>
            {state === 'merged' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,#8b5cf6_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[#8b5cf6]">
                <GitMerge size={11} /> Merged
              </span>
            ) : null}
            {state === 'closed' ? <Badge>Closed</Badge> : null}
            {pr.draft && state === 'open' ? <Badge>Draft</Badge> : null}
            {review ? (
              <Badge tone="accent">
                <Eye size={11} className="mr-1" /> Your review
              </Badge>
            ) : null}
            {pr.review === 'approved' ? (
              <Badge tone="success">
                <Check size={11} className="mr-1" /> Approved
              </Badge>
            ) : null}
            {pr.review === 'changes' ? (
              <Badge tone="danger">
                <MessageSquareWarning size={11} className="mr-1" /> Changes requested
              </Badge>
            ) : null}
            {pr.review === 'pending' && state === 'open' && !pr.draft ? (
              <Badge tone="warning">
                <Hourglass size={11} className="mr-1" /> Waiting for review
              </Badge>
            ) : null}
            {pr.checks === 'failing' ? (
              <Badge tone="danger">
                <CircleX size={11} className="mr-1" /> Checks failing
              </Badge>
            ) : null}
            {pr.checks === 'running' ? (
              <Badge tone="warning">
                <Loader size={11} className="mr-1" /> Checks running
              </Badge>
            ) : null}
            {pr.checks === 'passing' ? (
              <Badge tone="success">
                <CircleCheck size={11} className="mr-1" /> Checks pass
              </Badge>
            ) : null}
          </span>
        </span>
        {when ? <span className="text-[12px] text-orv-faint">{age(when)}</span> : null}
      </a>
    </li>
  );
}

/** GitHub in Today: my PRs as one line, then reviews waiting for me and issues assigned to me. */
export function GitHubCard() {
  const { has, prs, work } = useGitHub();
  const toast = useToast();
  if (!has) return null;
  const reviews = (work.data ?? []).filter((w) => w.kind === 'review');
  const issues = (work.data ?? []).filter((w) => w.kind === 'issue');
  return (
    <Glass as="section" className="p-4">
      <div className="mb-1 flex items-center gap-2 px-1">
        <ProviderMark id="github" size={16} />
        <Label>GitHub</Label>
      </div>
      <Link
        href="/today/prs"
        className="flex items-center gap-3 rounded-orv-md px-1.5 py-2 hover:bg-orv-track"
      >
        <GitPullRequest size={19} className="text-orv-success" aria-hidden />
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] font-medium">My pull requests</span>
          <span className="text-[12px] text-orv-muted">{prs.data ? prSummary(prs.data) : 'Looking…'}</span>
        </span>
        <ChevronRight size={15} className="text-orv-muted" aria-hidden />
      </Link>
      {work.data === undefined ? <SkeletonRows rows={1} className="mt-1" /> : null}
      <ul className="flex flex-col">
        {reviews.slice(0, 5).map((w) => (
          <PrRow key={w.id} pr={{ ...w, state: 'open' }} review />
        ))}
        {issues.slice(0, 5).map((w) => (
          <li key={w.id} className="flex items-center gap-2 px-1">
            <button
              type="button"
              aria-label={`Close issue: ${w.title}`}
              className="grid size-8 place-items-center rounded-full text-orv-success hover:bg-orv-track"
              onClick={async () => {
                try {
                  await api('/connections/github/issues/close', {
                    method: 'POST',
                    body: { connectionId: w.connectionId, repo: w.repo, number: w.number },
                  });
                  invalidate('github.');
                  toast({ title: 'Issue closed on GitHub', body: `${w.repo} #${w.number}`, tone: 'success' });
                } catch {
                  toast({ title: 'GitHub didn’t take it', tone: 'danger' });
                }
              }}
            >
              <CircleDot size={17} />
            </button>
            <a href={w.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 flex-col py-1.5">
              <span className="truncate text-[15px]">{w.title}</span>
              <span className="text-[12px] text-orv-muted">
                Assigned issue · {w.repo} #{w.number}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Glass>
  );
}

/** The Pull requests page (spec 0012 G). */
export function PrsView() {
  const { has, known, prs, work } = useGitHub();
  const [tab, setTab] = useState<'open' | 'review' | 'done'>('open');
  const [pings, setPings] = useState(false);
  if (known && !has)
    return (
      <Glass className="p-6 text-center text-small text-orv-muted">
        GitHub isn’t connected. Connect it in Settings → Connections.
      </Glass>
    );
  const all = prs.data ?? [];
  const open = all.filter((p) => p.state === 'open');
  const done = all
    .filter((p) => p.state !== 'open')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  const reviews = (work.data ?? []).filter((w) => w.kind === 'review');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div className="flex items-center gap-3">
          <ProviderMark id="github" size={32} />
          <div>
            <span className="text-small text-orv-muted">{prs.data ? prSummary(all) : 'GitHub'}</span>
            <h1 className="text-title font-semibold">Pull requests</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void prs.reload()} loading={prs.refreshing}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPings(true)}
            aria-label="Pull request notifications"
          >
            <BellRing size={14} />
          </Button>
        </div>
      </header>
      <Segmented<'open' | 'review' | 'done'>
        label="Which pull requests"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: `Mine · open${open.length ? ` ${open.length}` : ''}` },
          { value: 'review', label: `To review${reviews.length ? ` ${reviews.length}` : ''}` },
          { value: 'done', label: `Merged · closed${done.length ? ` ${done.length}` : ''}` },
        ]}
      />
      {prs.data === undefined && prs.error ? (
        <Glass className="flex items-center gap-3 p-4 text-small">
          GitHub didn’t answer.
          <Button size="sm" onClick={() => void prs.reload()}>
            Try again
          </Button>
        </Glass>
      ) : prs.data === undefined ? (
        <SkeletonRows rows={4} label="Loading pull requests" />
      ) : (
        <Glass as="section" className="p-3">
          <ul className="flex flex-col">
            {tab === 'open' ? (
              open.length ? (
                open.map((p) => <PrRow key={p.id} pr={p} />)
              ) : (
                <li className="p-2 text-small text-orv-muted">No open pull requests. Nice and clear.</li>
              )
            ) : tab === 'review' ? (
              reviews.length ? (
                reviews.map((w) => <PrRow key={w.id} pr={{ ...w, state: 'open' }} review />)
              ) : (
                <li className="p-2 text-small text-orv-muted">Nobody is waiting on your review.</li>
              )
            ) : done.length ? (
              done.map((p) => <PrRow key={p.id} pr={p} />)
            ) : (
              <li className="p-2 text-small text-orv-muted">Nothing merged or closed in the last 30 days.</li>
            )}
          </ul>
        </Glass>
      )}
      <PrPingsSheet open={pings} onClose={() => setPings(false)} />
    </div>
  );
}

export function PrPingsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const conns = useConnectionsCached();
  const toast = useToast();
  const [p, setP] = useState({ merged: true, changes: true, approved: false });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ping me when my PR…"
      subtitle="ORVYN looks every 15 minutes. One ping per change, never twice."
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            try {
              for (const c of (conns.data ?? []).filter((c) => c.provider === 'github'))
                await api('/connections/github/settings', {
                  method: 'PUT',
                  body: { connectionId: c.id, pings: p },
                });
              toast({ title: 'Saved', tone: 'success' });
              onClose();
            } catch {
              toast({ title: 'Couldn’t save', tone: 'danger' });
            }
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {(
          [
            ['merged', 'is merged'],
            ['changes', 'needs changes'],
            ['approved', 'is approved'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-medium">{label}</span>
            <Switch
              label={`Ping when my PR ${label}`}
              checked={p[k]}
              onChange={(v) => setP({ ...p, [k]: v })}
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}
