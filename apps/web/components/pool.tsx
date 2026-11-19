'use client';

import { formatMoney, type LedgerEntryInput, type PartnerFields, type SourceFields } from '@orvyn/contracts';
import {
  ArrowRight,
  Check,
  Copy,
  Link2,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Badge, Glass, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

// ------------------------------------------------------------------ shapes (as the API returns them)

export interface Partner extends PartnerFields {
  id: string;
}
export interface Source extends SourceFields {
  id: string;
}
interface Position {
  partnerId: string;
  name: string;
  cash: number;
  blocked: number;
  available: number;
  inShares: number;
  shareDue: number;
}
interface SourceBalance {
  sourceId: string;
  name: string;
  kind: string;
  given: number;
  back: number;
  fees: number;
  owed: number;
}
interface RoundSummary {
  id: string;
  issue: { id: string; name: string; status: string; closeDate: string | null; listingDate: string | null };
  accounts: number;
  applied: number;
  allotted: number;
  gainMinor: number;
  costsMinor: number;
  sharesMinor: number;
  netMinor: number;
}
export interface Summary {
  gainMinor: number;
  costsMinor: number;
  sharesMinor: number;
  netMinor: number;
  withPartnersMinor: number;
  inSharesMinor: number;
  sharesDueMinor: number;
  owedMinor: number;
  fromMeMinor: number;
  backHomeMinor: number;
  rounds: RoundSummary[];
  partners: Position[];
  sources: SourceBalance[];
}
interface Entry {
  id: string;
  at: string;
  kind: string;
  amountMinor: number;
  sourceId: string | null;
  partnerId: string | null;
  roundId: string | null;
  method: string;
  note: string;
  direction: string;
}

const m = (minor: number) => formatMoney(minor);
const KIND_WORD: Record<string, string> = {
  fund: 'Sent',
  return: 'Came back',
  repay: 'Repaid',
  cost: 'Cost',
  share: 'Their share',
  adjust: 'Correction',
};

function Tile({ k, v, tone, hint }: { k: string; v: string; tone?: 'good' | 'bad'; hint?: string }) {
  return (
    <Glass level="pane" className="flex flex-col gap-1 p-4">
      <span className="text-[11.5px] uppercase tracking-wide text-orv-muted">{k}</span>
      <span
        className={cn(
          'text-[22px] font-semibold tabular-nums',
          tone === 'good' && 'text-orv-success',
          tone === 'bad' && 'text-orv-danger',
        )}
      >
        {v}
      </span>
      {hint ? <span className="text-[12px] text-orv-muted">{hint}</span> : null}
    </Glass>
  );
}

/** Gross gains → what each thing took → what is left for you, as bars. */
function Waterfall({ s }: { s: Summary }) {
  const rows = [
    { k: 'Listing gains', v: s.gainMinor, tone: 'good' },
    { k: 'Card & other costs', v: -s.costsMinor, tone: 'bad' },
    { k: 'Partners’ shares', v: -s.sharesMinor, tone: 'bad' },
    { k: 'Net to you', v: s.netMinor, tone: s.netMinor >= 0 ? 'good' : 'bad' },
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <Glass level="pane" as="section" aria-label="Where the profit went" className="flex flex-col gap-3 p-5">
      <h2 className="text-[14px] font-semibold">Where the profit went</h2>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-[13px] text-orv-muted">{r.k}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-orv-track">
            <div
              className={cn('h-full rounded-full', r.tone === 'good' ? 'bg-orv-success' : 'bg-orv-danger')}
              style={{ width: `${(Math.abs(r.v) / max) * 100}%` }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-[13.5px] font-medium tabular-nums">
            {r.v < 0 ? '−' : ''}
            {m(Math.abs(r.v))}
          </span>
        </div>
      ))}
    </Glass>
  );
}

export function usePool() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const load = useCallback(async () => {
    const [s, p, src, l] = await Promise.all([
      api<Summary>('/ipo/pool/summary'),
      api<Partner[]>('/ipo/pool/partners'),
      api<Source[]>('/ipo/pool/sources'),
      api<Entry[]>('/ipo/pool/ledger'),
    ]);
    setSummary(s);
    setPartners(p);
    setSources(src);
    setLedger(l);
  }, []);
  useEffect(() => void load().catch(() => undefined), [load]);
  return { summary, partners, sources, ledger, reload: load };
}

/** The Pool: your money with partners, what you owe, every round, and where the profit went. */
export function PoolOverview() {
  const toast = useToast();
  const { summary: s, partners, sources, ledger, reload } = usePool();
  const [partner, setPartner] = useState<Partner | 'new' | null>(null);
  const [source, setSource] = useState<Source | 'new' | null>(null);
  const [money, setMoney] = useState<Partial<LedgerEntryInput> | null>(null);
  if (!s) return <SkeletonRows rows={5} label="Loading your Pool" />;
  const name = (id: string | null) =>
    partners.find((p) => p.id === id)?.name ?? sources.find((x) => x.id === id)?.name ?? '';
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          k="Net profit"
          v={m(s.netMinor)}
          tone={s.netMinor >= 0 ? 'good' : 'bad'}
          hint="after costs and shares"
        />
        <Tile k="With partners" v={m(s.withPartnersMinor)} hint="your money in their accounts" />
        <Tile k="In shares" v={m(s.inSharesMinor)} hint="allotted, not sold yet" />
        <Tile
          k="You owe"
          v={m(s.owedMinor)}
          tone={s.owedMinor > 0 ? 'bad' : undefined}
          hint="to family and others"
        />
      </div>

      <Waterfall s={s} />

      <Glass level="pane" as="section" aria-label="Partners" className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[14px] font-semibold">Partners</h2>
          <Button size="sm" variant="ghost" onClick={() => setMoney({ kind: 'fund' })}>
            <Send size={14} /> Record money
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPartner('new')}>
            <UserPlus size={14} /> Add
          </Button>
        </div>
        {!partners.length ? (
          <p className="text-small text-orv-muted">
            Add the people whose accounts apply — with what they get when they get an allotment.
          </p>
        ) : (
          <ul className="flex flex-col">
            {partners.map((p) => {
              const pos = s.partners.find((x) => x.partnerId === p.id);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 border-b border-orv-edge py-2.5 last:border-0"
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPartner(p)}>
                    <p className="text-[14px] font-semibold">
                      {p.name} {!p.active ? <Badge>paused</Badge> : null}
                    </p>
                    <p className="text-[12.5px] text-orv-muted">
                      {p.share.kind === 'none'
                        ? 'No share'
                        : p.share.kind === 'fixed'
                          ? `₹${p.share.value} per allotment`
                          : `${p.share.value}% of the gain`}
                      {p.relation ? ` · ${p.relation}` : ''}
                    </p>
                  </button>
                  <div className="text-right text-[13px] tabular-nums">
                    <p className="font-semibold">{m(pos?.cash ?? 0)}</p>
                    <p className="text-orv-muted">
                      {pos?.blocked ? `${m(pos.blocked)} blocked` : 'free'}
                      {pos?.shareDue ? ` · ${m(pos.shareDue)} share due` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMoney({ kind: 'fund', partnerId: p.id })}
                  >
                    Send
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Glass>

      <Glass level="pane" as="section" aria-label="Sources" className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[14px] font-semibold">Where the money comes from</h2>
          <Button size="sm" variant="ghost" onClick={() => setSource('new')}>
            <Plus size={14} /> Add
          </Button>
        </div>
        <ul className="flex flex-col">
          {sources.map((x) => {
            const b = s.sources.find((y) => y.sourceId === x.id);
            return (
              <li
                key={x.id}
                className="flex flex-wrap items-center gap-3 border-b border-orv-edge py-2.5 last:border-0"
              >
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSource(x)}>
                  <p className="text-[14px] font-semibold">{x.name}</p>
                  <p className="text-[12.5px] text-orv-muted">
                    {x.kind === 'card' ? `Card · ${x.feePct}% to use` : x.kind}
                    {x.repay ? ' · to be paid back' : ''}
                  </p>
                </button>
                <div className="text-right text-[13px] tabular-nums">
                  <p className="font-semibold">{m(b?.given ?? 0)} given</p>
                  <p className="text-orv-muted">
                    {b?.owed ? <span className="text-orv-danger">you owe {m(b.owed)}</span> : null}
                    {b?.fees ? `${b?.owed ? ' · ' : ''}${m(b.fees)} fees` : null}
                  </p>
                </div>
                {x.repay && (b?.owed ?? 0) > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMoney({ kind: 'repay', sourceId: x.id, amount: (b?.owed ?? 0) / 100 })}
                  >
                    Repay
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Glass>

      <Glass level="pane" as="section" aria-label="Rounds" className="flex flex-col gap-2 p-5">
        <h2 className="text-[14px] font-semibold">IPOs you applied to</h2>
        {!s.rounds.length ? (
          <p className="text-small text-orv-muted">
            Open an IPO in the Desk and choose “Apply from my accounts”.
          </p>
        ) : (
          s.rounds.map((r) => (
            <Link
              key={r.id}
              href={`/ipo/pool/rounds/${r.id}`}
              className="flex items-center gap-3 rounded-orv-md px-1 py-2 hover:bg-orv-track"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{r.issue.name}</p>
                <p className="text-[12.5px] text-orv-muted">
                  {r.applied}/{r.accounts} applied · {r.allotted} allotted
                </p>
              </div>
              <span
                className={cn(
                  'text-[13.5px] font-semibold tabular-nums',
                  r.netMinor >= 0 ? 'text-orv-success' : 'text-orv-danger',
                )}
              >
                {r.netMinor ? `${r.netMinor >= 0 ? '+' : '−'}${m(Math.abs(r.netMinor))}` : '—'}
              </span>
              <ArrowRight size={14} className="text-orv-faint" />
            </Link>
          ))
        )}
      </Glass>

      <Glass level="pane" as="section" aria-label="Ledger" className="flex flex-col gap-2 p-5">
        <h2 className="text-[14px] font-semibold">Every movement</h2>
        {!ledger.length ? (
          <p className="text-small text-orv-muted">
            Nothing yet. Balances above always add up from this list.
          </p>
        ) : (
          <ul className="flex flex-col">
            {ledger.slice(0, 40).map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 border-b border-orv-edge py-2 text-[13px] last:border-0"
              >
                <span className="w-20 shrink-0 text-orv-muted">
                  {new Date(e.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <strong>{KIND_WORD[e.kind] ?? e.kind}</strong>{' '}
                  {e.kind === 'fund'
                    ? `${name(e.sourceId)} → ${name(e.partnerId)}`
                    : e.kind === 'return'
                      ? `${name(e.partnerId)} → ${e.sourceId ? name(e.sourceId) : 'you'}`
                      : e.kind === 'repay'
                        ? `you → ${name(e.sourceId)}`
                        : name(e.partnerId) || name(e.sourceId)}
                  {e.note ? <span className="text-orv-muted"> · {e.note}</span> : null}
                </span>
                <span
                  className={cn(
                    'tabular-nums',
                    e.kind === 'cost' || e.kind === 'share' ? 'text-orv-danger' : '',
                  )}
                >
                  {m(e.amountMinor)}
                </span>
                {e.kind !== 'cost' || !e.note.includes('fee') ? (
                  <button
                    type="button"
                    aria-label="Remove this entry"
                    className="text-orv-faint hover:text-orv-danger"
                    onClick={async () => {
                      if (!window.confirm('Remove this entry? (Its card fee goes too.)')) return;
                      await api(`/ipo/pool/ledger/${e.id}`, { method: 'DELETE' });
                      toast({ title: 'Removed' });
                      await reload();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : (
                  <span className="w-[13px]" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Glass>

      {partner ? (
        <PartnerSheet
          partner={partner === 'new' ? null : partner}
          onClose={() => setPartner(null)}
          onSaved={reload}
        />
      ) : null}
      {source ? (
        <SourceSheet
          source={source === 'new' ? null : source}
          onClose={() => setSource(null)}
          onSaved={reload}
        />
      ) : null}
      {money ? (
        <MoneySheet
          initial={money}
          partners={partners}
          sources={sources}
          onClose={() => setMoney(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'h-8 rounded-full border px-3 text-[13px]',
            value === v
              ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent'
              : 'border-orv-edge text-orv-muted',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function PartnerSheet({
  partner,
  onClose,
  onSaved,
}: {
  partner: Partner | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<PartnerFields>(
    partner ?? {
      name: '',
      phone: '',
      upi: '',
      relation: '',
      categories: ['retail'],
      share: { kind: 'none', value: 0 },
      active: true,
      notes: '',
    },
  );
  const [link, setLink] = useState<string | null>(null);
  const save = async () => {
    try {
      await api(partner ? `/ipo/pool/partners/${partner.id}` : '/ipo/pool/partners', {
        method: partner ? 'PUT' : 'POST',
        body: f,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={partner ? partner.name : 'Add a partner'}
      subtitle="Someone whose account applies with your money."
      footer={
        <Button variant="primary" disabled={!f.name.trim()} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone (WhatsApp)">
            {(id) => (
              <Input
                id={id}
                inputMode="tel"
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
            )}
          </Field>
          <Field label="UPI ID">
            {(id) => <Input id={id} value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value })} />}
          </Field>
        </div>
        <Field label="Relation (optional)">
          {(id) => (
            <Input id={id} value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} />
          )}
        </Field>
        <div>
          <Label className="mb-2 block">Their share when they get an allotment</Label>
          <Chips
            label="Share rule"
            value={f.share.kind}
            onChange={(kind) =>
              setF({
                ...f,
                share: { kind, value: kind === 'none' ? 0 : f.share.value || (kind === 'fixed' ? 500 : 25) },
              })
            }
            options={[
              ['none', 'Nothing'],
              ['fixed', 'Fixed ₹'],
              ['percent', '% of the gain'],
            ]}
          />
          {f.share.kind !== 'none' ? (
            <div className="mt-2 w-40">
              <Field label={f.share.kind === 'fixed' ? '₹ per allotment' : '% of the gain'}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={String(f.share.value)}
                    onChange={(e) =>
                      setF({ ...f, share: { ...f.share, value: Number(e.target.value) || 0 } })
                    }
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px]">Can also apply as small HNI (₹2–10 lakh)</span>
          <Switch
            label="Small HNI"
            checked={f.categories.includes('snii')}
            onChange={(v) => setF({ ...f, categories: v ? ['retail', 'snii'] : ['retail'] })}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px]">Active</span>
          <Switch label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </div>
        {partner ? (
          <div className="rounded-orv-md border border-orv-edge p-3">
            <p className="text-[13px] font-semibold">Their private link</p>
            <p className="text-[12px] text-orv-muted">
              They tap “I applied”, “Allotted”, “Sold at…” — no app or account. A new link turns off the old
              one.
            </p>
            {link ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-orv-track px-2 py-1 text-[12px]">
                  {link}
                </code>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(link)}>
                  <Copy size={13} /> Copy
                </Button>
                {f.phone ? (
                  <a
                    className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-orv-accent hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://wa.me/${f.phone.replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91')}?text=${encodeURIComponent(`Hi ${f.name}, your IPO page: ${link}`)}`}
                  >
                    <MessageCircle size={13} /> WhatsApp
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () =>
                    setLink(
                      (
                        await api<{ url: string }>(`/ipo/pool/partners/${partner.id}/link`, {
                          method: 'POST',
                        })
                      ).url,
                    )
                  }
                >
                  <Link2 size={13} /> Make a link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/ipo/pool/partners/${partner.id}/link`, { method: 'DELETE' });
                    toast({ title: 'Their link is off' });
                  }}
                >
                  Turn off links
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

export function SourceSheet({
  source,
  onClose,
  onSaved,
}: {
  source: Source | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [f, setF] = useState<SourceFields>(
    source ?? { name: '', kind: 'family', feePct: 0, repay: true, active: true },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={source ? source.name : 'Add a source'}
      subtitle="Where money for IPOs comes from."
      footer={
        <Button
          variant="primary"
          disabled={!f.name.trim()}
          onClick={async () => {
            await api(source ? `/ipo/pool/sources/${source.id}` : '/ipo/pool/sources', {
              method: source ? 'PUT' : 'POST',
              body: f,
            });
            onSaved();
            onClose();
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" hint="e.g. Brother, Dad, HDFC card cash">
          {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Chips
          label="Kind"
          value={f.kind}
          onChange={(kind) =>
            setF({
              ...f,
              kind,
              repay: kind === 'family' ? true : kind === 'self' ? false : f.repay,
              feePct: kind === 'card' ? f.feePct || 2.5 : f.feePct,
            })
          }
          options={[
            ['self', 'My own'],
            ['family', 'Family'],
            ['card', 'Credit card'],
            ['other', 'Other'],
          ]}
        />
        <Field label="What it costs to use (%)" hint="Card cash, wallet loads… usually 2–3%">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={String(f.feePct)}
              onChange={(e) => setF({ ...f, feePct: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px]">Has to be paid back</span>
          <Switch label="Has to be paid back" checked={f.repay} onChange={(v) => setF({ ...f, repay: v })} />
        </div>
      </div>
    </Sheet>
  );
}

export function MoneySheet({
  initial,
  partners,
  sources,
  onClose,
  onSaved,
}: {
  initial: Partial<LedgerEntryInput>;
  partners: Partner[];
  sources: Source[];
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Partial<LedgerEntryInput>>({
    kind: 'fund',
    method: 'UPI',
    sourceId: sources[0]?.id ?? null,
    ...initial,
  });
  const src = sources.find((s) => s.id === f.sourceId);
  const fee = f.kind === 'fund' && src?.feePct && f.amount ? Math.round(f.amount * src.feePct) / 100 : 0;
  const select = (
    label: string,
    value: string | null | undefined,
    items: { id: string; name: string }[],
    set: (v: string) => void,
  ) => (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => set(e.target.value)}
          className="h-10 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px]"
        >
          <option value="" disabled>
            Choose…
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record money"
      subtitle="What you did, so every balance stays right. ORVYN never moves money."
      footer={
        <Button
          variant="primary"
          disabled={!f.amount}
          onClick={async () => {
            try {
              await api('/ipo/pool/ledger', { method: 'POST', body: f });
              toast({
                title: 'Recorded',
                body: fee ? `with a ₹${fee.toLocaleString('en-IN')} card fee` : undefined,
                tone: 'success',
              });
              onSaved();
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t record it', tone: 'danger' });
            }
          }}
        >
          <Check size={14} /> Record
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Chips
          label="What happened"
          value={f.kind ?? 'fund'}
          onChange={(kind) => setF({ ...f, kind })}
          options={[
            ['fund', 'I sent money'],
            ['return', 'Money came back'],
            ['repay', 'I paid a source back'],
            ['cost', 'A cost'],
          ]}
        />
        {f.kind === 'fund' || f.kind === 'repay' || f.kind === 'cost'
          ? select(f.kind === 'repay' ? 'To' : 'From', f.sourceId, sources, (v) =>
              setF({ ...f, sourceId: v }),
            )
          : null}
        {f.kind === 'fund' || f.kind === 'return'
          ? select(f.kind === 'fund' ? 'To' : 'From', f.partnerId, partners, (v) =>
              setF({ ...f, partnerId: v }),
            )
          : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                autoFocus
                value={f.amount ? String(f.amount) : ''}
                onChange={(e) => setF({ ...f, amount: Number(e.target.value) || undefined })}
              />
            )}
          </Field>
          <Field label="How">
            {(id) => (
              <select
                id={id}
                value={f.method}
                onChange={(e) => setF({ ...f, method: e.target.value })}
                className="h-10 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px]"
              >
                {['UPI', 'IMPS', 'NEFT', 'Cash', 'Card'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {fee ? (
          <p className="rounded-orv-md bg-[color-mix(in_srgb,var(--orv-warning)_12%,transparent)] px-3 py-2 text-[13px]">
            <Wallet size={13} className="mr-1 inline" /> {src?.name} costs {src?.feePct}%: a ₹
            {fee.toLocaleString('en-IN')} cost is recorded too.
          </p>
        ) : null}
        <Field label="Note (optional)">
          {(id) => (
            <Input id={id} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

/** Pick the accounts for an IPO. */
export function StartRoundSheet({
  issueId,
  issueName,
  onClose,
  onStarted,
}: {
  issueId: string;
  issueName: string;
  onClose(): void;
  onStarted(roundId: string): void;
}) {
  const toast = useToast();
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<'retail' | 'snii'>('retail');
  useEffect(() => {
    void api<Partner[]>('/ipo/pool/partners').then((p) => {
      const active = p.filter((x) => x.active);
      setPartners(active);
      setChosen(new Set(active.map((x) => x.id)));
    });
  }, []);
  const eligible = (partners ?? []).filter((p) => p.categories.includes(category));
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Apply to ${issueName}`}
      subtitle="Choose the accounts. ORVYN then shows who already holds enough and who needs money."
      footer={
        <Button
          variant="primary"
          disabled={![...chosen].some((id) => eligible.some((p) => p.id === id))}
          onClick={async () => {
            try {
              const r = await api<{ id: string }>('/ipo/pool/rounds', {
                method: 'POST',
                body: {
                  issueId,
                  category,
                  partnerIds: [...chosen].filter((id) => eligible.some((p) => p.id === id)),
                },
              });
              onStarted(r.id);
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t start it', tone: 'danger' });
            }
          }}
        >
          Plan it
        </Button>
      }
    >
      {partners === null ? (
        <SkeletonRows rows={3} label="Loading partners" />
      ) : !partners.length ? (
        <p className="text-small text-orv-muted">
          Add partners first in{' '}
          <Link href="/ipo?tab=pool" className="text-orv-accent underline">
            the Pool
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Chips
            label="Category"
            value={category}
            onChange={(v) => setCategory(v as 'retail' | 'snii')}
            options={[
              ['retail', 'Retail'],
              ['snii', 'Small HNI'],
            ]}
          />
          {eligible.map((p) => (
            <label key={p.id} className="flex items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                checked={chosen.has(p.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setChosen(next);
                }}
              />
              {p.name}
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function Stat({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] uppercase tracking-wide text-orv-muted">{k}</p>
      <p className="text-[15px] font-semibold tabular-nums">{v}</p>
    </div>
  );
}
