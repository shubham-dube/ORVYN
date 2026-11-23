'use client';

import {
  formatMoney,
  IPO_EVENTS,
  type IpoDecision,
  type IpoIssueView,
  type IpoOdds,
  type IpoSettings,
  type ManualFigures,
} from '@orvyn/contracts';
import {
  BellRing,
  CalendarCheck,
  Check,
  CircleCheck,
  CircleX,
  ExternalLink,
  FileText,
  Hand,
  Lock,
  PencilLine,
  Plus,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge, Glass, Label, Sheet, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

export interface FeedInfo {
  name: string;
  ready: boolean;
  credit: string | null;
  subscription: boolean;
}

export const rupees = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;
export const pct = (p: number | null | undefined, digits = 0) =>
  p === null || p === undefined ? '—' : `${p.toFixed(digits)}%`;
const times = (t: number | null | undefined) => (t === null || t === undefined ? '—' : `${t}×`);
const shortDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
export const chance = (p: number | null) =>
  p === null ? '—' : p >= 0.995 ? '100%' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`;
const crore = (n: number | null) => (n === null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')} cr`);
const signed = (n: number | null, digits = 0) =>
  n === null
    ? '—'
    : `${n >= 0 ? '+' : '−'}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: digits })}`;

const EVENT: Record<(typeof IPO_EVENTS)[number], [string, string]> = {
  announced: ['A new IPO is announced', 'With its size, price, a lot and the GMP.'],
  opens: ['It opens today', 'The morning bidding starts.'],
  closes: ['Last day to apply', 'In the morning, with retail demand so far.'],
  gmp: ['GMP moves a lot', 'Up or down by more than your threshold below.'],
  subscription: ['Retail demand milestones', 'When retail crosses 1×, 10× and 50×.'],
  allotment: ['Allotment day', 'The day results come out.'],
  listing: ['Listing day', 'With the gain at the open.'],
  decide: [
    'Ask me “Will you apply?” and follow up',
    'I’ll apply makes a task; then “applied?”, “allotted?”, and the listing.',
  ],
};

const today = () => new Date().toLocaleDateString('en-CA');
const daysTo = (d: string) =>
  Math.round((Date.parse(`${d}T00:00:00`) - Date.parse(`${today()}T00:00:00`)) / 86_400_000);
const weekday = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });

/** "Closes today 5 pm", "Opens Mon", "Lists Thu"… and how urgent it is. */
export function moment(i: IpoIssueView): { text: string; tone: 'hot' | 'live' | 'soon' | 'quiet' } {
  if (i.status === 'open' && i.closeDate) {
    const n = daysTo(i.closeDate);
    if (n <= 0) return { text: 'Closes today · 5 pm', tone: 'hot' };
    if (n === 1) return { text: 'Closes tomorrow', tone: 'live' };
    return { text: `Open · closes ${weekday(i.closeDate)}`, tone: 'live' };
  }
  if (i.status === 'upcoming') {
    if (!i.openDate) return { text: 'Dates soon', tone: 'quiet' };
    const n = daysTo(i.openDate);
    if (n <= 0) return { text: 'Opens today', tone: 'hot' };
    if (n === 1) return { text: 'Opens tomorrow', tone: 'soon' };
    return { text: n < 7 ? `Opens ${weekday(i.openDate)}` : `Opens ${shortDate(i.openDate)}`, tone: 'soon' };
  }
  if (i.status === 'closed') {
    if (i.allotmentDate && daysTo(i.allotmentDate) === 0) return { text: 'Allotment today', tone: 'hot' };
    if (i.listingDate)
      return {
        text: daysTo(i.listingDate) === 0 ? 'Lists today' : `Lists ${weekday(i.listingDate)}`,
        tone: 'soon',
      };
    return { text: 'Closed', tone: 'quiet' };
  }
  const g = i.listingGainPct;
  return { text: g === null ? 'Listed' : `Listed ${g >= 0 ? '+' : ''}${g.toFixed(1)}%`, tone: 'quiet' };
}

function MomentPill({ i }: { i: IpoIssueView }) {
  const m = moment(i);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
        m.tone === 'hot' && 'bg-[color-mix(in_srgb,var(--orv-danger)_14%,transparent)] text-orv-danger',
        m.tone === 'live' && 'bg-[color-mix(in_srgb,var(--orv-success)_14%,transparent)] text-orv-success',
        m.tone === 'soon' && 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent',
        m.tone === 'quiet' && 'bg-orv-track text-orv-muted',
      )}
    >
      {m.tone === 'hot' || m.tone === 'live' ? (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            m.tone === 'hot' ? 'bg-orv-danger' : 'bg-orv-success',
            'animate-pulse',
          )}
        />
      ) : null}
      {m.text}
    </span>
  );
}

/** The company's logo, or its first letter on the accent. */
export function IpoLogo({ i, size = 44 }: { i: Pick<IpoIssueView, 'logo' | 'name'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  return i.logo && !broken ? (
    <img
      src={i.logo}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-[14px] border border-orv-edge bg-white object-contain p-1"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="grid shrink-0 place-items-center rounded-[14px] bg-[image:var(--orv-accent-grad)] font-semibold text-white"
    >
      {i.name.slice(0, 1)}
    </span>
  );
}

export function StarButton({ issue, onChange }: { issue: IpoIssueView; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      aria-label={issue.starred ? `Unstar ${issue.name}` : `Star ${issue.name}`}
      aria-pressed={issue.starred}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await api(`/ipo/issues/${issue.id}/star`, { method: 'PUT', body: { on: !issue.starred } });
        onChange(!issue.starred);
      }}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-orv-muted hover:bg-orv-track hover:text-orv-warning"
    >
      <Star size={16} className={issue.starred ? 'fill-current text-orv-warning' : ''} />
    </button>
  );
}

function Tile({ k, v, sub, tone }: { k: string; v: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-orv-track/70 px-3 py-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-orv-muted">{k}</p>
      <p
        className={cn(
          'mt-0.5 truncate text-[17px] font-semibold tabular-nums',
          tone === 'up' && 'text-orv-success',
          tone === 'down' && 'text-orv-danger',
        )}
      >
        {v}
      </p>
      {sub ? <p className="truncate text-[11.5px] text-orv-muted tabular-nums">{sub}</p> : null}
    </div>
  );
}

/** The bar of how many times a category is subscribed (log scale, 1× marked). */
function DemandBar({ label, x, strong }: { label: string; x: number | null; strong?: boolean }) {
  if (x === null) return null;
  const w = Math.min(100, (Math.log10(Math.max(x, 0.1)) + 1) * 33.3);
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={cn('w-14 shrink-0 text-orv-muted', strong && 'font-semibold text-orv-text')}>
        {label}
      </span>
      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-orv-track">
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            x >= 1 ? 'bg-orv-success' : 'bg-orv-warning',
          )}
          style={{ width: `${w}%` }}
        />
        <span className="absolute inset-y-0 left-1/3 w-px bg-orv-edge" aria-hidden />
      </span>
      <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{times(x)}</span>
    </div>
  );
}

const DECISION_LABEL: Record<IpoDecision, string> = {
  applying: 'You’ll apply',
  skipped: 'Skipped',
  applied: 'Applied',
  allotted: 'Allotted 🎉',
  not_allotted: 'Not allotted',
};

async function decide(id: string, decision: IpoDecision | null) {
  return api<{ decision: IpoDecision | null; taskId: string | null }>(`/ipo/issues/${id}/decision`, {
    method: 'PUT',
    body: { decision },
  });
}

/** I'll apply · Skip; after that, what was decided (and the next step). */
export function DecisionBar({ i, onChange, big }: { i: IpoIssueView; onChange(): void; big?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async (d: IpoDecision | null, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setBusy(true);
    try {
      await decide(i.id, d);
      if (d === 'applying')
        toast({
          title: 'Added to Today',
          body: `Apply for ${i.name} by ${i.closeDate ? shortDate(i.closeDate) : 'the last day'}. You’ll be reminded that morning.`,
          tone: 'success',
        });
      onChange();
    } catch (err) {
      toast({ title: err instanceof ApiError ? err.message : 'That didn’t work', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const live = i.status === 'open' || i.status === 'upcoming';
  if (!i.decision)
    return live ? (
      <div className={cn('flex items-center gap-2', big && 'flex-wrap')}>
        {big ? <span className="mr-1 text-[13.5px] font-medium">Will you apply?</span> : null}
        <Button size="sm" variant="primary" loading={busy} onClick={(e) => void go('applying', e)}>
          <Hand size={14} /> I’ll apply
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={(e) => void go('skipped', e)}>
          Skip
        </Button>
      </div>
    ) : null;
  const next: [IpoDecision, string][] =
    i.decision === 'applying'
      ? [['applied', 'Applied ✓']]
      : i.decision === 'applied' && (i.status === 'closed' || i.status === 'listed')
        ? [
            ['allotted', 'Got it 🎉'],
            ['not_allotted', 'Not this time'],
          ]
        : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
          i.decision === 'skipped' || i.decision === 'not_allotted'
            ? 'bg-orv-track text-orv-muted'
            : 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent',
        )}
      >
        {i.decision === 'applying' ? (
          <CalendarCheck size={13} />
        ) : i.decision === 'skipped' ? (
          <CircleX size={13} />
        ) : (
          <CircleCheck size={13} />
        )}
        {DECISION_LABEL[i.decision]}
        {i.decision === 'applying' && i.closeDate ? ` · by ${shortDate(i.closeDate)}` : ''}
      </span>
      {next.map(([d, label]) => (
        <Button
          key={d}
          size="sm"
          variant={d === 'not_allotted' ? 'ghost' : 'primary'}
          loading={busy}
          onClick={(e) => void go(d, e)}
        >
          {label}
        </Button>
      ))}
      {big ? (
        <button
          type="button"
          className="text-[12px] text-orv-muted underline"
          onClick={(e) => void go(null, e)}
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}

/** One IPO as a card: the four numbers that decide it, when, how hot, and what you'll do. */
export function IssueCard({ i, onChange }: { i: IpoIssueView; onChange(): void }) {
  const s = i.subscription;
  const up = (i.gmp ?? 0) > 0;
  const lot = i.minInvestment ?? (i.priceMax && i.lotSize ? i.priceMax * i.lotSize : null);
  return (
    <Link href={`/ipo/${i.id}`} className="block" aria-label={i.name}>
      <Glass
        level="pane"
        className="flex h-full flex-col gap-3 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg"
      >
        <div className="flex items-start gap-3">
          <IpoLogo i={i} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15.5px] font-semibold leading-tight">{i.name}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-orv-muted">
              {i.type === 'sme' ? <Badge tone="warning">SME</Badge> : <span>Mainboard</span>}
              {i.priceMax ? (
                <span>
                  · ₹{i.priceMin && i.priceMin !== i.priceMax ? `${i.priceMin}–` : ''}
                  {i.priceMax}
                </span>
              ) : null}
              {i.listingOn ? <span>· {i.listingOn}</span> : null}
            </p>
          </div>
          <MomentPill i={i} />
          <StarButton issue={i} onChange={onChange} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            k="Issue size"
            v={crore(i.issueSizeCr)}
            sub={
              i.issueSizeCr === null
                ? ''
                : i.issueSizeCr >= 5000
                  ? 'Large'
                  : i.issueSizeCr >= 1000
                    ? 'Mid-size'
                    : 'Small'
            }
          />
          <Tile
            k="GMP"
            v={i.gmp === null ? '—' : `${up ? '+' : i.gmp < 0 ? '−' : ''}₹${Math.abs(i.gmp)}`}
            sub={i.gmp === null ? 'not reported' : `${pct(i.gmpPct, 1)} · est ${rupees(i.estListingPrice)}`}
            tone={i.gmp === null ? undefined : up ? 'up' : i.gmp < 0 ? 'down' : undefined}
          />
          <Tile k="1 lot" v={rupees(lot)} sub={i.lotSize ? `${i.lotSize} shares` : '—'} />
          <Tile
            k={i.status === 'listed' ? 'Listed' : 'Dates'}
            v={
              i.status === 'listed'
                ? shortDate(i.listingDate)
                : i.openDate
                  ? `${shortDate(i.openDate)}–${i.closeDate ? new Date(`${i.closeDate}T12:00:00`).getDate() : ''}`
                  : 'Soon'
            }
            sub={
              i.listingDate && i.status !== 'listed'
                ? `lists ${shortDate(i.listingDate)}`
                : i.status === 'listed'
                  ? rupees(i.listingPrice)
                  : ''
            }
          />
        </div>
        {s && (s.retail !== null || s.total !== null) && i.status !== 'upcoming' ? (
          <div className="flex flex-col gap-1">
            <DemandBar label="Retail" x={s.retail} strong />
            <DemandBar label="Total" x={s.total} />
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {i.gainPerLot !== null && i.status !== 'listed' ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums',
                i.gainPerLot >= 0 ? 'text-orv-success' : 'text-orv-danger',
              )}
            >
              {i.gainPerLot >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {signed(i.gainPerLot)} a lot
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-orv-muted">{i.verdict}</span>
        </div>
        <DecisionBar i={i} onChange={onChange} />
      </Glass>
    </Link>
  );
}

function OddsCard({ o, lotSize }: { o: IpoOdds; lotSize: number | null }) {
  return (
    <div className="rounded-orv-md border border-orv-edge p-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-orv-muted">
        {o.category === 'retail' ? 'Retail (up to ₹2 lakh)' : 'Small HNI (₹2–10 lakh)'}
      </p>
      <p className="mt-1 text-[26px] font-semibold tabular-nums">{chance(o.chance)}</p>
      <p className="text-[12.5px] text-orv-muted">
        {o.basis === 'exact'
          ? 'from applications'
          : o.basis === 'estimate'
            ? 'estimate from the subscription'
            : 'once bidding starts'}
      </p>
      <p className="mt-2 text-[12.5px]">
        Minimum: {o.minLots} {o.minLots === 1 ? 'lot' : 'lots'}
        {lotSize ? ` (${(o.minLots * lotSize).toLocaleString('en-IN')} shares)` : ''} · {rupees(o.minAmount)}
      </p>
      {o.lotsOnOffer ? (
        <p className="text-[12.5px] text-orv-muted">
          ~{o.lotsOnOffer.toLocaleString('en-IN')} winners possible
        </p>
      ) : null}
    </div>
  );
}

/** GMP over time, from ORVYN's own history: a soft area under the line, the last point marked. */
function Trend({ points }: { points: { at: string; gmp: number | null }[] }) {
  const xs = points.filter((p) => p.gmp !== null) as { at: string; gmp: number }[];
  if (xs.length < 2)
    return <p className="text-[12.5px] text-orv-muted">The trend shows after a few refreshes.</p>;
  const min = Math.min(...xs.map((p) => p.gmp));
  const max = Math.max(...xs.map((p) => p.gmp));
  const w = 320;
  const h = 72;
  const pt = (p: { gmp: number }, n: number) =>
    [
      ((n / (xs.length - 1)) * w).toFixed(1),
      (h - ((p.gmp - min) / (max - min || 1)) * (h - 12) - 6).toFixed(1),
    ] as const;
  const line = xs.map((p, n) => `${n ? 'L' : 'M'}${pt(p, n).join(',')}`).join(' ');
  const last = pt(xs.at(-1)!, xs.length - 1);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-[72px] w-full overflow-visible"
      role="img"
      aria-label={`GMP from ₹${xs[0]!.gmp} to ₹${xs.at(-1)!.gmp}`}
    >
      <defs>
        <linearGradient id="gmp-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--orv-accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--orv-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#gmp-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--orv-accent)"
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--orv-accent)" />
    </svg>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-orv-muted">{k}</span>
      <span className="text-[14px] font-medium tabular-nums">{v}</span>
    </div>
  );
}

/** Open → close → allotment → refund → demat → listing, with today marked. */
function Timeline({ d }: { d: IssueDetail }) {
  const steps = (
    [
      ['Opens', d.openDate],
      ['Closes', d.closeDate],
      ['Allotment', d.allotmentDate],
      ['Refunds', d.refundDate],
      ['In demat', d.details?.creditToDematDate ?? null],
      ['Listing', d.listingDate],
    ] as const
  ).filter(([, v]) => v);
  const t = today();
  const nextAt = steps.findIndex(([, v]) => v! >= t);
  return (
    <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6" aria-label="Timeline">
      {steps.map(([k, v], n) => {
        const past = v! < t;
        const now = n === nextAt;
        return (
          <li key={k} className="relative flex flex-col items-center text-center">
            {n > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute right-1/2 top-[11px] -z-0 h-0.5 w-full',
                  past || now ? 'bg-orv-accent' : 'bg-orv-edge',
                )}
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-white',
                past
                  ? 'border-orv-accent bg-orv-accent'
                  : now
                    ? 'border-orv-accent bg-[var(--orv-base)]'
                    : 'border-orv-edge bg-[var(--orv-base)]',
              )}
            >
              {past ? (
                <Check size={13} />
              ) : now ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-orv-accent" />
              ) : null}
            </span>
            <span
              className={cn('mt-1.5 text-[11.5px] font-semibold', now ? 'text-orv-accent' : 'text-orv-muted')}
            >
              {k}
            </span>
            <span className="text-[13px] tabular-nums">{shortDate(v)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export type IssueDetail = IpoIssueView & {
  history: { at: string; gmp: number | null; retail: number | null; total: number | null }[];
  roundId: string | null;
};

export function IssueDetailView({
  d,
  onChange,
  onStartRound,
}: {
  d: IssueDetail;
  onChange(): void;
  onStartRound(): void;
}) {
  const [figures, setFigures] = useState(false);
  const s = d.subscription;
  const x = d.details;
  const up = (d.gmp ?? 0) >= 0;
  const lot = d.minInvestment ?? (d.priceMax && d.lotSize ? d.priceMax * d.lotSize : null);
  const company =
    x && (x.about || x.objects?.length || x.financials || x.leadManagers?.length || x.strengths?.length);
  return (
    <div className="flex flex-col gap-4">
      {/* the hero */}
      <Glass level="float" className="relative overflow-hidden p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[image:var(--orv-accent-grad)] opacity-20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <IpoLogo i={d} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <MomentPill i={d} />
              {d.type === 'sme' ? <Badge tone="warning">SME</Badge> : <Badge>Mainboard</Badge>}
              {d.listingOn ? <Badge>{d.listingOn}</Badge> : null}
            </div>
            <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-tight">{d.name}</h1>
            <p className="mt-1 text-[14px] text-orv-muted">
              {d.priceMax
                ? `₹${d.priceMin && d.priceMin !== d.priceMax ? `${d.priceMin}–` : ''}${d.priceMax} a share`
                : 'Price soon'}
              {d.lotSize ? ` · ${d.lotSize} a lot · ${rupees(lot)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <StarButton issue={d} onChange={onChange} />
            <Button variant="ghost" size="sm" onClick={() => setFigures(true)}>
              <PencilLine size={14} /> Type figures
            </Button>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile k="Issue size" v={crore(d.issueSizeCr)} />
          <Tile
            k="GMP"
            v={d.gmp === null ? '—' : `${up ? '+' : '−'}₹${Math.abs(d.gmp)}`}
            sub={d.gmp === null ? 'not reported' : pct(d.gmpPct, 1)}
            tone={d.gmp === null ? undefined : up ? 'up' : 'down'}
          />
          <Tile k="1 lot" v={rupees(lot)} sub={d.lotSize ? `${d.lotSize} shares` : ''} />
          <Tile
            k="A lot may make"
            v={signed(d.gainPerLot)}
            sub="at today’s GMP"
            tone={d.gainPerLot === null ? undefined : d.gainPerLot >= 0 ? 'up' : 'down'}
          />
        </div>
      </Glass>

      {/* your plan */}
      <Glass level="pane" as="section" aria-label="Your plan" className="flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles size={18} className="text-orv-accent" />
          <p className="min-w-0 flex-1 text-[14px]">{d.verdict}</p>
        </div>
        <DecisionBar i={d} onChange={onChange} big />
        {d.decision === 'applying' ? (
          <p className="text-[12.5px] text-orv-muted">
            A task in{' '}
            <Link href="/today" className="text-orv-accent underline">
              Today
            </Link>{' '}
            is due on the last day, with a reminder that morning. Bids close at 5 pm; approve the UPI mandate
            the same day.
          </p>
        ) : null}
      </Glass>

      <div className="grid gap-4 md:grid-cols-2">
        <Glass level="pane" as="section" aria-label="GMP" className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-[14px] font-semibold">Grey-market premium</h2>
            <Badge tone="warning">unofficial</Badge>
          </div>
          <div className="flex items-baseline gap-3">
            <p
              className={cn(
                'text-[30px] font-semibold tabular-nums',
                up ? 'text-orv-success' : 'text-orv-danger',
              )}
            >
              {d.gmp === null ? '—' : `${up ? '+' : '−'}₹${Math.abs(d.gmp)}`}
            </p>
            <p className="text-[14px] text-orv-muted">
              {pct(d.gmpPct, 1)} · est. listing {rupees(d.estListingPrice)}
            </p>
          </div>
          <Trend points={d.history} />
          <p className="text-[12px] text-orv-muted">
            {d.gmpUpdatedAt ? `Updated ${new Date(d.gmpUpdatedAt).toLocaleString()}` : 'Not reported yet'}
            {d.manual.includes('gmp') ? ' · typed in' : ''}
            {d.sauda ? ` · subject-to-sauda ₹${d.sauda.toLocaleString('en-IN')}` : ''}
            {d.kostak ? ` · kostak ₹${d.kostak}` : ''}
          </p>
        </Glass>

        <Glass level="pane" as="section" aria-label="Subscription" className="flex flex-col gap-2.5 p-5">
          <h2 className="text-[14px] font-semibold">How hot is it</h2>
          {s ? (
            <div className="flex flex-col gap-2">
              <DemandBar label="Retail" x={s.retail} strong />
              <DemandBar label="Small HNI" x={s.snii} />
              <DemandBar label="Big HNI" x={s.bnii} />
              <DemandBar label="NII" x={s.snii === null ? s.nii : null} />
              <DemandBar label="QIB" x={s.qib} />
              <DemandBar label="Employee" x={s.employee} />
              <DemandBar label="Total" x={s.total} strong />
            </div>
          ) : (
            <p className="text-small text-orv-muted">No figures yet — they come once bidding starts.</p>
          )}
          <p className="text-[12px] text-orv-muted">
            {s?.applications?.retail
              ? `${s.applications.retail.toLocaleString('en-IN')} retail applications · `
              : ''}
            {s?.updatedAt ? `As of ${new Date(s.updatedAt).toLocaleString()}` : ''}
            {d.manual.includes('subscription') ? ' · typed in' : ''}
          </p>
        </Glass>
      </div>

      <Glass level="pane" as="section" aria-label="Dates" className="p-5">
        <h2 className="mb-4 text-[14px] font-semibold">When</h2>
        <Timeline d={d} />
      </Glass>

      <Glass
        level="pane"
        as="section"
        aria-label="Key facts"
        className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4"
      >
        <Fact
          k="Price band"
          v={
            d.priceMax
              ? `₹${d.priceMin && d.priceMin !== d.priceMax ? `${d.priceMin}–` : ''}${d.priceMax}`
              : '—'
          }
        />
        <Fact k="Minimum investment" v={rupees(lot)} />
        <Fact k="Face value" v={d.faceValue ? `₹${d.faceValue}` : '—'} />
        <Fact k="Type of sale" v={d.saleType ?? '—'} />
        <Fact k="Est. listing" v={rupees(d.estListingPrice)} />
        <Fact k="Listing at" v={d.listingOn ?? '—'} />
        {d.status === 'listed' ? (
          <Fact k="Listed at" v={`${rupees(d.listingPrice)} (${pct(d.listingGainPct, 1)})`} />
        ) : null}
        {d.cmp ? <Fact k="Price now" v={rupees(d.cmp)} /> : null}
        {x?.employeeDiscount ? <Fact k="Employee discount" v={x.employeeDiscount} /> : null}
      </Glass>

      <Glass level="pane" as="section" aria-label="Your odds" className="flex flex-col gap-3 p-5">
        <h2 className="text-[14px] font-semibold">Your odds</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {d.odds.map((o) => (
            <OddsCard key={o.category} o={o} lotSize={d.lotSize} />
          ))}
        </div>
        {d.pool ? (
          <div className="rounded-orv-md bg-[color-mix(in_srgb,var(--orv-accent)_8%,transparent)] p-4">
            <p className="text-[13px] font-semibold">With your {d.pool.accounts} accounts</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact
                k="Expected allotments"
                v={d.pool.expectedAllotments === null ? '—' : d.pool.expectedAllotments.toFixed(2)}
              />
              <Fact k="At least one" v={chance(d.pool.chanceAtLeastOne)} />
              <Fact k="Card cost to fund" v={rupees(d.pool.cardCost)} />
              <Fact
                k="Expected gain"
                v={
                  d.pool.expectedGain === null ? (
                    '—'
                  ) : (
                    <span className={d.pool.expectedGain >= 0 ? 'text-orv-success' : 'text-orv-danger'}>
                      {signed(d.pool.expectedGain)}
                    </span>
                  )
                }
              />
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {d.roundId ? (
            <Link href={`/ipo/pool/rounds/${d.roundId}`}>
              <Button variant="primary" size="sm">
                <Users size={14} /> Open your round
              </Button>
            </Link>
          ) : d.status === 'open' || d.status === 'upcoming' ? (
            <Button variant="secondary" size="sm" onClick={onStartRound}>
              <Users size={14} /> Apply from my accounts
            </Button>
          ) : null}
        </div>
      </Glass>

      {company ? (
        <Glass level="pane" as="section" aria-label="Company" className="flex flex-col gap-4 p-5">
          <h2 className="text-[14px] font-semibold">The company</h2>
          {x!.about ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{x!.about}</p> : null}
          <div className="grid gap-4 md:grid-cols-2">
            {x!.strengths?.length ? (
              <div>
                <Label className="mb-1.5 block">Strengths</Label>
                <ul className="list-disc pl-5 text-[13.5px]">
                  {x!.strengths.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {x!.risks?.length ? (
              <div>
                <Label className="mb-1.5 block">Risks</Label>
                <ul className="list-disc pl-5 text-[13.5px]">
                  {x!.risks.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {x!.objects?.length ? (
              <div>
                <Label className="mb-1.5 block">What the money is for</Label>
                <ul className="list-disc pl-5 text-[13.5px]">
                  {x!.objects.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {x!.leadManagers?.length || x!.registrar ? (
              <div className="text-[13.5px]">
                {x!.leadManagers?.length ? (
                  <>
                    <Label className="mb-1.5 block">Lead managers</Label>
                    <p>{x!.leadManagers.join(', ')}</p>
                  </>
                ) : null}
                {x!.registrar ? (
                  <p className="mt-2">
                    Registrar:{' '}
                    {x!.registrar.statusPage ? (
                      <a
                        className="text-orv-accent underline"
                        href={x!.registrar.statusPage}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {x!.registrar.name} — check allotment
                      </a>
                    ) : (
                      x!.registrar.name
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          {x!.financials?.rows.length ? (
            <div className="overflow-x-auto">
              <Label className="mb-1.5 block">
                Financials{x!.financials.unit ? ` (${x!.financials.unit})` : ''}
              </Label>
              <table className="w-full text-[13px] tabular-nums">
                <thead>
                  <tr className="text-orv-muted">
                    <th className="py-1 text-left font-medium" />
                    {x!.financials.headers.map((h) => (
                      <th key={h} className="py-1 text-right font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {x!.financials.rows.map((r) => (
                    <tr key={r.metric} className="border-t border-orv-edge">
                      <td className="py-1.5 text-orv-muted">{r.metric}</td>
                      {r.data.map((v, n) => (
                        <td key={n} className="py-1.5 text-right">
                          {v ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {x!.documents?.length ? (
            <div className="flex flex-wrap gap-2">
              {x!.documents.map((doc) => (
                <a
                  key={doc.url}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full field-ring px-3 py-1 text-[12.5px]"
                >
                  <FileText size={13} /> {doc.label}
                </a>
              ))}
            </div>
          ) : null}
        </Glass>
      ) : x?.locked?.length ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-orv-muted">
          <Lock size={13} /> Company details, financials and lead managers need IPO Guru’s Basic plan (₹99 a
          month).
        </p>
      ) : null}

      {d.sourceUrl ? (
        <p className="px-1 text-[12px] text-orv-faint">
          Data:{' '}
          <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            {d.source} <ExternalLink size={10} className="inline" />
          </a>{' '}
          · GMP is unofficial · not investment advice
        </p>
      ) : (
        <p className="px-1 text-[12px] text-orv-faint">
          Typed in by hand · GMP is unofficial · not investment advice
        </p>
      )}

      <FiguresSheet open={figures} issue={d} onClose={() => setFigures(false)} onSaved={onChange} />
    </div>
  );
}

/** When there is no feed (or to correct it): type GMP, subscription and the listing price. */
function FiguresSheet({
  open,
  issue,
  onClose,
  onSaved,
}: {
  open: boolean;
  issue: IpoIssueView;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    setF({
      gmp: issue.gmp?.toString() ?? '',
      retail: issue.subscription?.retail?.toString() ?? '',
      snii: issue.subscription?.snii?.toString() ?? '',
      total: issue.subscription?.total?.toString() ?? '',
      apps: issue.subscription?.applications?.retail?.toString() ?? '',
      listing: issue.listingPrice?.toString() ?? '',
    });
  }, [issue, open]);
  const n = (k: string) => (f[k]?.trim() ? Number(f[k]) : null);
  const save = async () => {
    const body: ManualFigures = {
      ...(f.gmp?.trim() ? { gmp: n('gmp') } : {}),
      subscription: {
        ...(f.retail?.trim() ? { retail: n('retail') } : {}),
        ...(f.snii?.trim() ? { snii: n('snii') } : {}),
        ...(f.total?.trim() ? { total: n('total') } : {}),
        ...(f.apps?.trim() ? { retailApplications: n('apps') } : {}),
      },
      ...(f.listing?.trim() ? { listingPrice: n('listing') } : {}),
    };
    try {
      await api(`/ipo/issues/${issue.id}/figures`, { method: 'PUT', body });
      toast({ title: 'Saved', tone: 'success' });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
    }
  };
  const field = (k: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => (
        <Input
          id={id}
          inputMode="decimal"
          value={f[k] ?? ''}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Type figures"
      subtitle="They stay until you clear them, even when the feed refreshes."
      footer={
        <>
          {issue.manual.length ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await api(`/ipo/issues/${issue.id}/figures`, { method: 'DELETE' });
                onSaved();
                onClose();
              }}
            >
              Back to the feed
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {field('gmp', 'GMP (₹)')}
        {field('listing', 'Listing price (₹)')}
        {field('retail', 'Retail (×)')}
        {field('snii', 'Small HNI (×)')}
        {field('total', 'Total (×)')}
        {field('apps', 'Retail applications', 'Makes the odds exact')}
      </div>
    </Sheet>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px]">{title}</p>
        {hint ? <p className="text-[12px] text-orv-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Chips<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'h-8 rounded-full border px-3 text-[13px] transition-colors',
            value === v
              ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] font-medium text-orv-accent'
              : 'border-orv-edge text-orv-muted hover:bg-orv-track',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The desk and its notifications: what shows, which IPOs ping, which moments, and "Will you apply?". */
export function IpoSettingsSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  onSaved?(): void;
}) {
  const toast = useToast();
  const [s, setS] = useState<IpoSettings | null>(null);
  useEffect(() => {
    if (open) void api<IpoSettings>('/ipo/settings').then(setS);
  }, [open]);
  if (!s) return null;
  const toggle = <T,>(xs: T[], x: T, on: boolean) =>
    on ? [...new Set([...xs, x])] : xs.filter((y) => y !== x);
  const types = (t: 'mainboard' | 'sme', on: boolean) => {
    const next = toggle(s.types, t, on);
    return next.length ? next : s.types;
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="IPO desk & notifications"
      subtitle="What you see, what pings you, and when. Starred IPOs always get through."
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            await api('/ipo/settings', { method: 'PUT', body: s });
            toast({ title: 'Saved', tone: 'success' });
            onSaved?.();
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <Label className="mb-2 block">On the desk</Label>
          <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
            <Row title="Show SME IPOs too" hint="Off: the desk shows mainboard IPOs only.">
              <Switch label="Show SME" checked={s.showSme} onChange={(v) => setS({ ...s, showSme: v })} />
            </Row>
          </div>
        </section>

        <section>
          <Label className="mb-2 block">Will you apply?</Label>
          <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
            <Row title={EVENT.decide[0]} hint={EVENT.decide[1]}>
              <Switch
                label="Ask and follow up"
                checked={s.events.includes('decide')}
                onChange={(v) => setS({ ...s, events: toggle(s.events, 'decide', v) })}
              />
            </Row>
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[14px]">Apply by, on the last day</p>
              <Chips
                label="Apply by"
                value={s.applyBy}
                options={[
                  ['11:00', '11 am'],
                  ['13:00', '1 pm'],
                  ['14:00', '2 pm'],
                  ['15:30', '3:30 pm'],
                ]}
                onChange={(v) => setS({ ...s, applyBy: v })}
              />
              <p className="mt-1.5 text-[12px] text-orv-muted">
                Bids close at 5 pm, and UPI mandates can be slow late in the day.
              </p>
            </div>
          </div>
        </section>

        <section>
          <Label className="mb-2 block">Which IPOs ping you</Label>
          <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[14px]">Issue size</p>
              <Chips
                label="Minimum issue size"
                value={s.minIssueSizeCr}
                options={[
                  [0, 'Any'],
                  [500, '₹500 cr+'],
                  [1000, '₹1,000 cr+'],
                  [2500, '₹2,500 cr+'],
                  [5000, '₹5,000 cr+'],
                ]}
                onChange={(v) => setS({ ...s, minIssueSizeCr: v })}
              />
            </div>
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[14px]">GMP of at least</p>
              <Chips
                label="Minimum GMP"
                value={s.minGmpPct}
                options={[
                  [null, 'Any'],
                  [5, '5%'],
                  [10, '10%'],
                  [20, '20%'],
                  [30, '30%'],
                ]}
                onChange={(v) => setS({ ...s, minGmpPct: v })}
              />
            </div>
            <Row title="Mainboard">
              <Switch
                label="Mainboard"
                checked={s.types.includes('mainboard')}
                onChange={(v) => setS({ ...s, types: types('mainboard', v) })}
              />
            </Row>
            <Row title="SME">
              <Switch
                label="SME"
                checked={s.types.includes('sme')}
                onChange={(v) => setS({ ...s, types: types('sme', v) })}
              />
            </Row>
            <Row title="Only IPOs I starred">
              <Switch
                label="Only starred"
                checked={s.onlyStarred}
                onChange={(v) => setS({ ...s, onlyStarred: v })}
              />
            </Row>
          </div>
        </section>

        <section>
          <Label className="mb-2 block">Moments</Label>
          <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
            {IPO_EVENTS.filter((e) => e !== 'decide').map((e) => (
              <Row key={e} title={EVENT[e][0]} hint={EVENT[e][1]}>
                <Switch
                  label={EVENT[e][0]}
                  checked={s.events.includes(e)}
                  onChange={(v) => setS({ ...s, events: toggle(s.events, e, v) })}
                />
              </Row>
            ))}
          </div>
        </section>

        <section>
          <Label className="mb-2 block">Keep it calm</Label>
          <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[14px]">A GMP move worth a ping</p>
              <Chips
                label="GMP move"
                value={s.gmpMovePct}
                options={[
                  [3, '3 pts'],
                  [5, '5 pts'],
                  [10, '10 pts'],
                  [20, '20 pts'],
                ]}
                onChange={(v) => setS({ ...s, gmpMovePct: v })}
              />
            </div>
            <div className="px-3 py-2.5">
              <p className="mb-2 text-[14px]">At most a day</p>
              <Chips
                label="At most a day"
                value={s.maxPerDay}
                options={[
                  [2, '2'],
                  [4, '4'],
                  [6, '6'],
                  [10, '10'],
                  [20, '20'],
                ]}
                onChange={(v) => setS({ ...s, maxPerDay: v })}
              />
            </div>
          </div>
        </section>
      </div>
    </Sheet>
  );
}

/** Add an IPO by hand (no feed yet, or one the feed doesn't carry). */
export function AddIssueSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose(): void;
  onAdded(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ type: 'mainboard' });
  const ok = ['name', 'openDate', 'closeDate', 'priceMax', 'lotSize', 'issueSizeCr'].every((k) =>
    f[k]?.trim(),
  );
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add an IPO"
      subtitle="From the offer document or the exchange’s page."
      footer={
        <Button
          variant="primary"
          disabled={!ok}
          onClick={async () => {
            try {
              await api('/ipo/issues', {
                method: 'POST',
                body: {
                  name: f.name,
                  type: f.type,
                  openDate: f.openDate,
                  closeDate: f.closeDate,
                  allotmentDate: f.allotmentDate || null,
                  listingDate: f.listingDate || null,
                  priceMin: f.priceMin ? Number(f.priceMin) : null,
                  priceMax: Number(f.priceMax),
                  lotSize: Number(f.lotSize),
                  issueSizeCr: Number(f.issueSizeCr),
                },
              });
              onAdded();
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t add it', tone: 'danger' });
            }
          }}
        >
          <Plus size={14} /> Add
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Company">
            {(id) => <Input id={id} value={f.name ?? ''} onChange={set('name')} />}
          </Field>
        </div>
        <Field label="Opens">
          {(id) => <Input id={id} type="date" value={f.openDate ?? ''} onChange={set('openDate')} />}
        </Field>
        <Field label="Closes">
          {(id) => <Input id={id} type="date" value={f.closeDate ?? ''} onChange={set('closeDate')} />}
        </Field>
        <Field label="Allotment">
          {(id) => (
            <Input id={id} type="date" value={f.allotmentDate ?? ''} onChange={set('allotmentDate')} />
          )}
        </Field>
        <Field label="Listing">
          {(id) => <Input id={id} type="date" value={f.listingDate ?? ''} onChange={set('listingDate')} />}
        </Field>
        <Field label="Price from (₹)">
          {(id) => <Input id={id} inputMode="decimal" value={f.priceMin ?? ''} onChange={set('priceMin')} />}
        </Field>
        <Field label="Price to (₹)">
          {(id) => <Input id={id} inputMode="decimal" value={f.priceMax ?? ''} onChange={set('priceMax')} />}
        </Field>
        <Field label="Lot (shares)">
          {(id) => <Input id={id} inputMode="numeric" value={f.lotSize ?? ''} onChange={set('lotSize')} />}
        </Field>
        <Field label="Issue size (₹ cr)">
          {(id) => (
            <Input id={id} inputMode="decimal" value={f.issueSizeCr ?? ''} onChange={set('issueSizeCr')} />
          )}
        </Field>
        <div className="col-span-2 flex items-center gap-3">
          <span className="flex-1 text-[14px]">SME</span>
          <Switch
            label="SME"
            checked={f.type === 'sme'}
            onChange={(v) => setF({ ...f, type: v ? 'sme' : 'mainboard' })}
          />
        </div>
      </div>
    </Sheet>
  );
}

export function NotifyButton({ onClick }: { onClick(): void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <BellRing size={14} /> Notifications
    </Button>
  );
}

export { formatMoney };
