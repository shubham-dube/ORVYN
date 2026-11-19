'use client';

import { formatMoney, type LedgerEntryInput } from '@orvyn/contracts';
import { ArrowLeft, Check, MessageCircle, Send } from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { MoneySheet, type Partner, type Source, Stat } from '@/components/pool';
import { Badge, Glass, Sheet, SkeletonCards, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

interface App {
  id: string;
  partner: { id: string; name: string; upi: string; phone: string };
  category: string;
  lots: number;
  amountMinor: number;
  status: string;
  reportedBy: string;
  allottedLots: number | null;
  soldPrice: number | null;
  holdsMinor: number;
  fundedMinor: number;
  needMinor: number;
  suggestion: { sourceId: string; source: string; feeMinor: number } | null;
  gainMinor: number | null;
  shareMinor: number | null;
  backMinor: number | null;
}
interface Round {
  id: string;
  issue: {
    id: string;
    name: string;
    status: string;
    closeDate: string | null;
    listingDate: string | null;
    priceMax: number | null;
    lotSize: number | null;
    gmp: number | null;
    listingPrice: number | null;
  };
  accounts: number;
  applied: number;
  allotted: number;
  gainMinor: number;
  costsMinor: number;
  sharesMinor: number;
  netMinor: number;
  applications: App[];
  toSendMinor: number;
  feesIfCheapestMinor: number;
}

const STEPS = ['planned', 'funded', 'applied', 'mandate', 'allotted', 'sold', 'settled'];
const WORD: Record<string, string> = {
  planned: 'Planned',
  funded: 'Money sent',
  applied: 'Applied',
  mandate: 'Mandate accepted',
  allotted: 'Allotted',
  not_allotted: 'Not allotted',
  sold: 'Sold',
  settled: 'Settled',
};
const m = (x: number) => formatMoney(x);

function Steps({ status }: { status: string }) {
  const at = status === 'not_allotted' ? STEPS.indexOf('allotted') : STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1" aria-label={WORD[status]}>
      {STEPS.map((s, n) => (
        <span
          key={s}
          className={cn(
            'h-1.5 w-5 rounded-full',
            n <= at
              ? status === 'not_allotted' && n === at
                ? 'bg-orv-muted'
                : 'bg-orv-accent'
              : 'bg-orv-track',
          )}
        />
      ))}
    </div>
  );
}

export default function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [r, setR] = useState<Round | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [money, setMoney] = useState<Partial<LedgerEntryInput> | null>(null);
  const [sale, setSale] = useState<App | null>(null);
  const [settle, setSettle] = useState<App | null>(null);
  const load = useCallback(async () => {
    const [round, p, s] = await Promise.all([
      api<Round>(`/ipo/pool/rounds/${id}`),
      api<Partner[]>('/ipo/pool/partners'),
      api<Source[]>('/ipo/pool/sources'),
    ]);
    setR(round);
    setPartners(p);
    setSources(s);
  }, [id]);
  useEffect(() => void load().catch(() => undefined), [load]);
  if (!r) return <SkeletonCards count={3} label="Loading the round" />;
  const update = async (a: App, body: Record<string, unknown>) => {
    try {
      await api(`/ipo/pool/applications/${a.id}`, { method: 'PUT', body });
      await load();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
    }
  };
  const whatsapp = async (a: App) => {
    const { url } = await api<{ url: string }>(`/ipo/pool/partners/${a.partner.id}/link`, { method: 'POST' });
    const text = `Hi ${a.partner.name}, please apply to the ${r.issue.name} IPO: ${a.lots} lot${a.lots > 1 ? 's' : ''} (${m(a.amountMinor)}) before ${r.issue.closeDate ?? 'it closes'}. Accept the UPI mandate after. Tap here when done: ${url}`;
    const phone = a.partner.phone.replace(/\D/g, '').replace(/^(?=\d{10}$)/, '91');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/ipo?tab=pool"
        className="inline-flex items-center gap-1 px-1 text-[13px] text-orv-muted hover:text-orv-text"
      >
        <ArrowLeft size={14} /> My Pool
      </Link>
      <header className="flex flex-wrap items-end gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold">{r.issue.name}</h1>
          <p className="text-small text-orv-muted">
            {r.applied}/{r.accounts} applied · {r.allotted} allotted · closes {r.issue.closeDate ?? '—'}
          </p>
        </div>
        <Link href={`/ipo/${r.issue.id}`} className="text-[13px] text-orv-accent hover:underline">
          The IPO →
        </Link>
      </header>

      <Glass level="pane" className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
        <Stat k="Still to send" v={m(r.toSendMinor)} />
        <Stat k="Card cost if cheapest" v={m(r.feesIfCheapestMinor)} />
        <Stat k="Gains" v={m(r.gainMinor)} />
        <Stat k="Costs + shares" v={m(r.costsMinor + r.sharesMinor)} />
        <Stat
          k="Net to you"
          v={
            <span className={r.netMinor >= 0 ? 'text-orv-success' : 'text-orv-danger'}>{m(r.netMinor)}</span>
          }
        />
      </Glass>

      <div className="flex flex-col gap-3">
        {r.applications.map((a) => (
          <Glass
            key={a.id}
            level="pane"
            as="section"
            aria-label={a.partner.name}
            className="flex flex-col gap-3 p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">
                  {a.partner.name}{' '}
                  {a.reportedBy === 'partner' ? <Badge tone="accent">said so themselves</Badge> : null}
                </p>
                <p className="text-[12.5px] text-orv-muted">
                  {a.lots} lot{a.lots > 1 ? 's' : ''} · {m(a.amountMinor)} ·{' '}
                  {a.category === 'snii' ? 'small HNI' : 'retail'}
                  {a.partner.upi ? ` · ${a.partner.upi}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[13px] font-medium">{WORD[a.status]}</span>
                <Steps status={a.status} />
              </div>
            </div>

            {['planned', 'funded'].includes(a.status) ? (
              <div className="flex flex-wrap items-center gap-2 rounded-orv-md bg-orv-track px-3 py-2 text-[13px]">
                {a.needMinor === 0 ? (
                  <span>
                    Holds {m(a.holdsMinor)} of yours — <strong>nothing to send</strong>.
                  </span>
                ) : (
                  <span>
                    Holds {m(a.holdsMinor)} · needs <strong>{m(a.needMinor)}</strong>
                    {a.suggestion
                      ? ` — cheapest: ${a.suggestion.source}${a.suggestion.feeMinor ? ` (fee ${m(a.suggestion.feeMinor)})` : ''}`
                      : ''}
                  </span>
                )}
                <div className="flex-1" />
                {a.needMinor > 0 ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      setMoney({
                        kind: 'fund',
                        partnerId: a.partner.id,
                        roundId: r.id,
                        amount: a.needMinor / 100,
                        sourceId: a.suggestion?.sourceId ?? null,
                      })
                    }
                  >
                    <Send size={13} /> Record transfer
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {a.partner.phone && ['planned', 'funded'].includes(a.status) ? (
                <Button size="sm" variant="ghost" onClick={() => void whatsapp(a)}>
                  <MessageCircle size={13} /> Ask on WhatsApp
                </Button>
              ) : null}
              {['planned', 'funded'].includes(a.status) ? (
                <Button size="sm" variant="ghost" onClick={() => void update(a, { status: 'applied' })}>
                  <Check size={13} /> Applied
                </Button>
              ) : null}
              {a.status === 'applied' ? (
                <Button size="sm" variant="ghost" onClick={() => void update(a, { status: 'mandate' })}>
                  Mandate accepted
                </Button>
              ) : null}
              {['applied', 'mandate'].includes(a.status) ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void update(a, { allottedLots: 1 })}>
                    🎉 Allotted
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void update(a, { status: 'not_allotted' })}
                  >
                    Not allotted
                  </Button>
                </>
              ) : null}
              {a.status === 'allotted' ? (
                <Button size="sm" variant="primary" onClick={() => setSale(a)}>
                  Sold…
                </Button>
              ) : null}
              {a.status === 'sold' ? (
                <Button size="sm" variant="primary" onClick={() => setSettle(a)}>
                  Settle with {a.partner.name}
                </Button>
              ) : null}
            </div>

            {a.gainMinor !== null ? (
              <div className="grid grid-cols-3 gap-3 border-t border-orv-edge pt-3">
                <Stat k={`Gain at ₹${a.soldPrice}`} v={m(a.gainMinor)} />
                <Stat k="Their share" v={m(a.shareMinor ?? 0)} />
                <Stat k="They send back" v={a.backMinor === null ? '—' : m(a.backMinor)} />
              </div>
            ) : null}
            {a.status === 'not_allotted' ? (
              <p className="text-[12.5px] text-orv-muted">
                Their {m(a.amountMinor)} stays with them as float for the next IPO.
              </p>
            ) : null}
          </Glass>
        ))}
      </div>

      {money ? (
        <MoneySheet
          initial={money}
          partners={partners}
          sources={sources}
          onClose={() => setMoney(null)}
          onSaved={() => void load()}
        />
      ) : null}
      {sale ? (
        <SaleSheet
          app={sale}
          suggested={
            r.issue.listingPrice ??
            (r.issue.priceMax && r.issue.gmp !== null ? r.issue.priceMax + r.issue.gmp : null)
          }
          onClose={() => setSale(null)}
          onSave={async (price, costs) => {
            await update(sale, { soldPrice: price, saleCosts: costs });
            setSale(null);
          }}
        />
      ) : null}
      {settle ? (
        <SettleSheet
          app={settle}
          onClose={() => setSettle(null)}
          onDone={async () => {
            setSettle(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function SaleSheet({
  app,
  suggested,
  onClose,
  onSave,
}: {
  app: App;
  suggested: number | null;
  onClose(): void;
  onSave(price: number, costs: number): Promise<void>;
}) {
  const [price, setPrice] = useState(suggested ? String(suggested) : '');
  const [costs, setCosts] = useState('20');
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${app.partner.name} sold`}
      subtitle="The price per share, and the broker’s charges."
      footer={
        <Button
          variant="primary"
          disabled={!Number(price)}
          onClick={() => void onSave(Number(price), Number(costs) || 0)}
        >
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sold at (₹ a share)">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field label="Charges (₹)">
          {(id) => (
            <Input id={id} inputMode="decimal" value={costs} onChange={(e) => setCosts(e.target.value)} />
          )}
        </Field>
      </div>
    </Sheet>
  );
}

function SettleSheet({ app, onClose, onDone }: { app: App; onClose(): void; onDone(): Promise<void> }) {
  const toast = useToast();
  const full = (app.backMinor ?? 0) / 100;
  const profitOnly = Math.max(0, ((app.gainMinor ?? 0) - (app.shareMinor ?? 0)) / 100);
  const [keep, setKeep] = useState(false);
  const [amount, setAmount] = useState(String(full));
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Settle with ${app.partner.name}`}
      subtitle={`They keep ${m(app.shareMinor ?? 0)}. Everything is recorded in the ledger.`}
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await api(`/ipo/pool/applications/${app.id}/settle`, {
                method: 'POST',
                body: { returned: Number(amount) || 0 },
              });
              toast({ title: 'Settled', tone: 'success' });
              await onDone();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t settle', tone: 'danger' });
            }
          }}
        >
          <Check size={14} /> Settle
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[14px]">
          <input
            type="checkbox"
            checked={keep}
            onChange={(e) => {
              setKeep(e.target.checked);
              setAmount(String(e.target.checked ? profitOnly : full));
            }}
          />
          Keep the principal with them for the next IPO (they send only the profit)
        </label>
        <Field label="They sent you (₹)">
          {(id) => (
            <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
