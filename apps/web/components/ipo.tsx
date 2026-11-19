'use client';

import {
  formatMoney,
  IPO_EVENTS,
  type IpoIssueView,
  type IpoOdds,
  type IpoSettings,
  type ManualFigures,
} from '@orvyn/contracts';
import { BellRing, ExternalLink, PencilLine, Plus, Star, Users } from 'lucide-react';
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

const EVENT_NAME: Record<(typeof IPO_EVENTS)[number], string> = {
  announced: 'A new IPO is announced',
  opens: 'It opens today',
  closes: 'Last day to apply (morning)',
  gmp: 'GMP moves a lot',
  subscription: 'Retail crosses 1×, 10×, 50×',
  allotment: 'Allotment day',
  listing: 'Listing day, with the gain',
};

function GmpChip({ i }: { i: Pick<IpoIssueView, 'gmp' | 'gmpPct'> }) {
  if (i.gmp === null) return <Badge>GMP —</Badge>;
  const tone =
    (i.gmpPct ?? 0) >= 25
      ? 'success'
      : (i.gmpPct ?? 0) >= 8
        ? 'accent'
        : (i.gmpPct ?? 0) > 0
          ? 'neutral'
          : 'danger';
  return (
    <Badge tone={tone}>
      GMP ₹{i.gmp} · {pct(i.gmpPct)}
    </Badge>
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
      className="grid h-8 w-8 place-items-center rounded-full text-orv-muted hover:bg-orv-track hover:text-orv-warning"
    >
      <Star size={16} className={issue.starred ? 'fill-current text-orv-warning' : ''} />
    </button>
  );
}

/** One IPO as a card in the desk: what it is, the money line, odds, and the honest verdict. */
export function IssueCard({ i, onStar }: { i: IpoIssueView; onStar(on: boolean): void }) {
  const retail = i.odds.find((o) => o.category === 'retail');
  return (
    <Link href={`/ipo/${i.id}`} className="block" aria-label={i.name}>
      <Glass level="pane" className="flex flex-col gap-3 p-4 transition-transform hover:-translate-y-0.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold">{i.name}</h3>
              <Badge tone={i.status === 'open' ? 'success' : 'neutral'}>{i.status}</Badge>
              {i.type === 'sme' ? <Badge tone="warning">SME</Badge> : null}
            </div>
            <p className="mt-0.5 text-[12.5px] text-orv-muted">
              {i.issueSizeCr ? `₹${Math.round(i.issueSizeCr).toLocaleString('en-IN')} cr` : 'Size —'} ·{' '}
              {i.priceMax
                ? `₹${i.priceMin && i.priceMin !== i.priceMax ? `${i.priceMin}–` : ''}${i.priceMax}`
                : 'Price —'}{' '}
              · {retail ? `${rupees(retail.minAmount)} a lot` : ''} · {shortDate(i.openDate)}–
              {shortDate(i.closeDate)}
            </p>
          </div>
          <StarButton issue={i} onChange={onStar} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GmpChip i={i} />
          {i.subscription?.retail != null ? <Badge>Retail {times(i.subscription.retail)}</Badge> : null}
          {i.subscription?.total != null ? <Badge>Total {times(i.subscription.total)}</Badge> : null}
          {retail?.chance != null ? <Badge tone="accent">Odds {chance(retail.chance)}</Badge> : null}
          {i.pool ? (
            <Badge tone="accent">
              <Users size={11} className="mr-1 inline" aria-hidden />
              {i.pool.accounts} accounts
            </Badge>
          ) : null}
        </div>
        <p className="text-[13px] text-orv-muted">{i.verdict}</p>
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

/** GMP over time, from ORVYN's own history. */
function Trend({ points }: { points: { at: string; gmp: number | null }[] }) {
  const xs = points.filter((p) => p.gmp !== null) as { at: string; gmp: number }[];
  if (xs.length < 2)
    return <p className="text-[12.5px] text-orv-muted">The trend shows after a few refreshes.</p>;
  const min = Math.min(...xs.map((p) => p.gmp));
  const max = Math.max(...xs.map((p) => p.gmp));
  const w = 320;
  const h = 64;
  const d = xs
    .map(
      (p, n) =>
        `${n ? 'L' : 'M'}${((n / (xs.length - 1)) * w).toFixed(1)},${(h - ((p.gmp - min) / (max - min || 1)) * (h - 8) - 4).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-16 w-full"
      role="img"
      aria-label={`GMP from ₹${xs[0]!.gmp} to ₹${xs.at(-1)!.gmp}`}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--orv-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11.5px] uppercase tracking-wide text-orv-muted">{k}</span>
      <span className="text-[14px] font-medium tabular-nums">{v}</span>
    </div>
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
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3 px-1 pt-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-title font-semibold">{d.name}</h1>
            <Badge tone={d.status === 'open' ? 'success' : 'neutral'}>{d.status}</Badge>
            {d.type === 'sme' ? <Badge tone="warning">SME</Badge> : null}
          </div>
          <p className="mt-1 text-small text-orv-muted">{d.verdict}</p>
        </div>
        <StarButton issue={d} onChange={onChange} />
        <Button variant="ghost" size="sm" onClick={() => setFigures(true)}>
          <PencilLine size={14} /> Type figures
        </Button>
      </header>

      <Glass level="pane" className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Fact
          k="Issue size"
          v={d.issueSizeCr ? `₹${Math.round(d.issueSizeCr).toLocaleString('en-IN')} cr` : '—'}
        />
        <Fact
          k="Price"
          v={
            d.priceMax
              ? `₹${d.priceMin && d.priceMin !== d.priceMax ? `${d.priceMin}–` : ''}${d.priceMax}`
              : '—'
          }
        />
        <Fact k="Lot" v={d.lotSize ? `${d.lotSize} shares` : '—'} />
        <Fact k="Est. listing" v={rupees(d.estListingPrice)} />
        <Fact k="Opens" v={shortDate(d.openDate)} />
        <Fact k="Closes" v={shortDate(d.closeDate)} />
        <Fact k="Allotment" v={shortDate(d.allotmentDate)} />
        <Fact k="Listing" v={shortDate(d.listingDate)} />
      </Glass>

      <div className="grid gap-4 md:grid-cols-2">
        <Glass level="pane" as="section" aria-label="GMP" className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-[14px] font-semibold">Grey-market premium</h2>
            <Badge tone="warning">unofficial</Badge>
          </div>
          <p className="text-[28px] font-semibold tabular-nums">
            {d.gmp === null ? '—' : `₹${d.gmp}`}{' '}
            <span className="text-[15px] text-orv-muted">{pct(d.gmpPct, 1)}</span>
          </p>
          <Trend points={d.history} />
          <p className="text-[12px] text-orv-muted">
            {d.gmpUpdatedAt ? `Updated ${new Date(d.gmpUpdatedAt).toLocaleString()}` : 'Not reported yet'}
            {d.manual.includes('gmp') ? ' · typed in' : ''}
          </p>
        </Glass>

        <Glass level="pane" as="section" aria-label="Subscription" className="flex flex-col gap-2 p-5">
          <h2 className="text-[14px] font-semibold">Subscription</h2>
          {s ? (
            <table className="w-full text-[13.5px] tabular-nums">
              <tbody>
                {(
                  [
                    ['QIB', s.qib],
                    ['NII', s.nii],
                    ['Small HNI', s.snii],
                    ['Big HNI', s.bnii],
                    ['Retail', s.retail],
                    ['Employee', s.employee],
                    ['Total', s.total],
                  ] as const
                )
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => (
                    <tr key={k} className="border-b border-orv-edge last:border-0">
                      <td className="py-1.5 text-orv-muted">{k}</td>
                      <td className="py-1.5 text-right font-medium">{times(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="text-small text-orv-muted">No figures yet — they come once bidding starts.</p>
          )}
          {s?.applications?.retail ? (
            <p className="text-[12px] text-orv-muted">
              {s.applications.retail.toLocaleString('en-IN')} retail applications
            </p>
          ) : null}
          <p className="text-[12px] text-orv-muted">
            {s?.updatedAt ? `As of ${new Date(s.updatedAt).toLocaleString()}` : ''}
            {d.manual.includes('subscription') ? ' · typed in' : ''}
          </p>
        </Glass>
      </div>

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
                      {d.pool.expectedGain >= 0 ? '+' : '−'}
                      {rupees(Math.abs(d.pool.expectedGain))}
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
            <Button variant="primary" size="sm" onClick={onStartRound}>
              <Users size={14} /> Apply from my accounts
            </Button>
          ) : null}
        </div>
      </Glass>

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

/** What pings you, and when. */
export function IpoSettingsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const [s, setS] = useState<IpoSettings | null>(null);
  useEffect(() => {
    if (open) void api<IpoSettings>('/ipo/settings').then(setS);
  }, [open]);
  if (!s) return null;
  const toggle = <T,>(xs: T[], x: T, on: boolean) =>
    on ? [...new Set([...xs, x])] : xs.filter((y) => y !== x);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="IPO notifications"
      subtitle="Which IPOs, and which moments. Starred IPOs always pass."
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            await api('/ipo/settings', { method: 'PUT', body: s });
            toast({ title: 'Saved', tone: 'success' });
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <Label className="mb-2 block">Which IPOs</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Minimum issue size">
            {[0, 500, 1000, 2500, 5000].map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={s.minIssueSizeCr === v}
                onClick={() => setS({ ...s, minIssueSizeCr: v })}
                className={cn(
                  'h-8 rounded-full border px-3 text-[13px]',
                  s.minIssueSizeCr === v
                    ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent'
                    : 'border-orv-edge text-orv-muted',
                )}
              >
                {v === 0 ? 'Any size' : `₹${v.toLocaleString('en-IN')} cr+`}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">Mainboard</span>
              <Switch
                label="Mainboard"
                checked={s.types.includes('mainboard')}
                onChange={(v) =>
                  setS({
                    ...s,
                    types: toggle(s.types, 'mainboard', v).length ? toggle(s.types, 'mainboard', v) : s.types,
                  })
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">SME</span>
              <Switch
                label="SME"
                checked={s.types.includes('sme')}
                onChange={(v) =>
                  setS({
                    ...s,
                    types: toggle(s.types, 'sme', v).length ? toggle(s.types, 'sme', v) : s.types,
                  })
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">Only with GMP of at least</span>
              <select
                aria-label="Minimum GMP"
                value={s.minGmpPct ?? ''}
                onChange={(e) =>
                  setS({ ...s, minGmpPct: e.target.value === '' ? null : Number(e.target.value) })
                }
                className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-2 text-[14px]"
              >
                <option value="">any</option>
                {[5, 10, 20, 30, 50].map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">Only IPOs I starred</span>
              <Switch
                label="Only starred"
                checked={s.onlyStarred}
                onChange={(v) => setS({ ...s, onlyStarred: v })}
              />
            </div>
          </div>
        </div>
        <div>
          <Label className="mb-2 block">When to ping</Label>
          <div className="flex flex-col gap-2">
            {IPO_EVENTS.map((e) => (
              <div key={e} className="flex items-center gap-3">
                <span className="flex-1 text-[14px]">{EVENT_NAME[e]}</span>
                <Switch
                  label={EVENT_NAME[e]}
                  checked={s.events.includes(e)}
                  onChange={(v) => setS({ ...s, events: toggle(s.events, e, v) })}
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">GMP move worth a ping</span>
              <select
                aria-label="GMP move"
                value={s.gmpMovePct}
                onChange={(e) => setS({ ...s, gmpMovePct: Number(e.target.value) })}
                className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-2 text-[14px]"
              >
                {[3, 5, 10, 20].map((v) => (
                  <option key={v} value={v}>
                    {v} points
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">At most a day</span>
              <select
                aria-label="At most a day"
                value={s.maxPerDay}
                onChange={(e) => setS({ ...s, maxPerDay: Number(e.target.value) })}
                className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-2 text-[14px]"
              >
                {[2, 4, 6, 10, 20].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
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
