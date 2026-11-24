'use client';

import { formatMoney, type LedgerEntryInput } from '@orvyn/contracts';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  MessageCircle,
  PencilLine,
  RotateCcw,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { MoneySheet, type Partner, type Source, Stat } from '@/components/pool';
import { Badge, Glass, Sheet, SkeletonCards, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  MENU_STATUSES,
  MESSAGE_WORD,
  type MessageKind,
  nextActions,
  preview,
  STAGES,
  type Stage,
  STATUS_WORD,
  trackRecord,
} from '@/lib/pool-roster';

interface App {
  id: string;
  partner: { id: string; name: string; upi: string; phone: string };
  category: string;
  lots: number;
  amountMinor: number;
  status: string;
  stage: Stage;
  canUndo: boolean;
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
interface RosterRow {
  partner: { id: string; name: string; phone: string; upi: string; relation: string };
  applicationId: string | null;
  status: string | null;
  stage: Stage | null;
  record: { applied: number; of: number; missed: number; lastMissed: string | null; missedLast: boolean };
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
  roster: RosterRow[];
  board: {
    stages: Record<Stage, number>;
    applied: number;
    mandates: number;
    notYet: string[];
    mandatePending: string[];
    missed: string[];
    noReply: string[];
    declined: string[];
  };
  closed: boolean;
  closesAt: string | null;
  toSendMinor: number;
  feesIfCheapestMinor: number;
}
interface Message {
  partnerId: string;
  name: string;
  phone: string;
  text: string;
  url: string;
}
const m = (x: number) => formatMoney(x);
const STAGE_TONE: Record<Stage, string> = {
  not_asked: 'bg-orv-faint',
  asked: 'bg-orv-warning',
  will_apply: 'bg-orv-accent',
  applied: 'bg-[color-mix(in_srgb,var(--orv-success)_60%,var(--orv-accent))]',
  mandate: 'bg-orv-success',
  out: 'bg-orv-danger',
};

/** Opens WhatsApp from a click even after an await: the tab is opened first, then pointed at the chat. */
function openChat(load: () => Promise<string>) {
  const w = window.open('', '_blank');
  void load().then(
    (url) => {
      if (w) w.location.href = url;
      else window.open(url, '_blank', 'noopener');
    },
    () => w?.close(),
  );
}

/**
 * One IPO with my partners (spec 0018): everyone on a board by stage — ask, yes, money, applied, mandate — moved
 * one at a time or many at once, forward or back, with Undo; WhatsApp in my words; and the summary at the close.
 */
export default function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const [r, setR] = useState<Round | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [money, setMoney] = useState<Partial<LedgerEntryInput> | null>(null);
  const [sale, setSale] = useState<App | null>(null);
  const [settle, setSettle] = useState<App | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<{ kind: MessageKind; ids: string[] } | null>(null);
  const [templates, setTemplates] = useState(false);
  const [showOut, setShowOut] = useState(false);
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
  const appOf = useMemo(() => new Map((r?.applications ?? []).map((a) => [a.partner.id, a])), [r]);
  if (!r) return <SkeletonCards count={3} label="Loading the round" />;

  const fail = (e: unknown) =>
    toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
  const move = async (ids: string[], status: string) => {
    try {
      setR(
        await api<Round>(`/ipo/pool/rounds/${id}/partners`, {
          method: 'PUT',
          body: { partnerIds: ids, status },
        }),
      );
      setPicked(new Set());
    } catch (e) {
      fail(e);
    }
  };
  const update = async (a: App, body: Record<string, unknown>) => {
    try {
      await api(`/ipo/pool/applications/${a.id}`, { method: 'PUT', body });
      await load();
    } catch (e) {
      fail(e);
    }
  };
  const undo = async (a: App) => {
    try {
      setR(await api<Round>(`/ipo/pool/applications/${a.id}/undo`, { method: 'POST' }));
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (pid: string) => {
    try {
      setR(await api<Round>(`/ipo/pool/rounds/${id}/partners/${pid}`, { method: 'DELETE' }));
    } catch (e) {
      fail(e);
    }
  };
  const message = (pid: string, kind: MessageKind) =>
    openChat(async () => {
      const [x] = await api<Message[]>(`/ipo/pool/rounds/${id}/messages`, {
        method: 'POST',
        body: { partnerIds: [pid], kind },
      });
      void load();
      return x!.url;
    });

  const inRound = r.roster.filter((x) => x.status !== null);
  const outside = r.roster.filter((x) => x.status === null);
  const total = inRound.length;
  const pickedIds = [...picked];
  const pickedHavePhones = pickedIds.filter(
    (pid) => r.roster.find((x) => x.partner.id === pid)?.partner.phone,
  );

  return (
    <div className="flex flex-col gap-4 pb-24">
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
            {r.closed ? 'Bids closed' : r.closesAt ? `Bids close ${r.closesAt}` : 'Close date not out yet'}
            {r.issue.gmp !== null ? ` · GMP ₹${r.issue.gmp}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setTemplates(true)}>
          <PencilLine size={14} /> Messages
        </Button>
        <Link href={`/ipo/${r.issue.id}`} className="text-[13px] text-orv-accent hover:underline">
          The IPO →
        </Link>
      </header>

      {/* the round at a glance: a bar of where everyone is */}
      <Glass level="pane" className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold">
            {total
              ? `${r.board.applied} of ${total} applied · ${r.board.mandates} mandates done`
              : 'Nobody in this round yet'}
          </p>
          {outside.length ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void move(
                  outside.map((x) => x.partner.id),
                  'to_ask',
                )
              }
            >
              <UserPlus size={14} /> Add everyone ({outside.length})
            </Button>
          ) : null}
        </div>
        {total ? (
          <div className="flex h-2.5 overflow-hidden rounded-full bg-orv-track" aria-hidden>
            {STAGES.map((s) =>
              r.board.stages[s.key] ? (
                <span
                  key={s.key}
                  className={cn('h-full transition-all', STAGE_TONE[s.key])}
                  style={{ width: `${(r.board.stages[s.key] / total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STAGES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[12.5px] text-orv-muted">
              <span className={cn('h-2 w-2 rounded-full', STAGE_TONE[s.key])} />
              {s.label} <strong className="tabular-nums text-orv-text">{r.board.stages[s.key]}</strong>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-orv-edge pt-3 sm:grid-cols-4">
          <Stat k="Still to send" v={m(r.toSendMinor)} />
          <Stat k="Card cost if cheapest" v={m(r.feesIfCheapestMinor)} />
          <Stat k="Gains" v={m(r.gainMinor)} />
          <Stat
            k="Net to you"
            v={
              <span className={r.netMinor >= 0 ? 'text-orv-success' : 'text-orv-danger'}>
                {m(r.netMinor)}
              </span>
            }
          />
        </div>
      </Glass>

      {r.closed ? <CloseSummary r={r} /> : null}

      {STAGES.map((s) => {
        const rows = inRound.filter((x) => x.stage === s.key);
        if (!rows.length) return null;
        const folded = s.key === 'out' && !showOut;
        return (
          <section key={s.key} aria-label={s.label} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => s.key === 'out' && setShowOut(!showOut)}
              className="flex items-center gap-2 px-1 text-left"
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', STAGE_TONE[s.key])} />
              <span className="text-[14px] font-semibold">{s.label}</span>
              <Badge>{rows.length}</Badge>
              <span className="truncate text-[12.5px] text-orv-muted">{s.hint}</span>
              {s.key === 'out' ? (
                <ChevronDown size={15} className={cn('ml-auto text-orv-muted', showOut && 'rotate-180')} />
              ) : null}
            </button>
            {folded ? null : (
              <Glass level="pane" className="flex flex-col divide-y divide-orv-edge p-1.5">
                {rows.map((x) => (
                  <PersonRow
                    key={x.partner.id}
                    x={x}
                    a={appOf.get(x.partner.id)}
                    picked={picked.has(x.partner.id)}
                    onPick={(on) => {
                      const next = new Set(picked);
                      if (on) next.add(x.partner.id);
                      else next.delete(x.partner.id);
                      setPicked(next);
                    }}
                    onMove={(st) => void move([x.partner.id], st)}
                    onMessage={(k) => message(x.partner.id, k)}
                    onUndo={(a) => void undo(a)}
                    onRemove={() => void remove(x.partner.id)}
                    onFund={(a) =>
                      setMoney({
                        kind: 'fund',
                        partnerId: a.partner.id,
                        roundId: r.id,
                        amount: a.needMinor / 100,
                        sourceId: a.suggestion?.sourceId ?? null,
                      })
                    }
                    onSale={setSale}
                    onSettle={setSettle}
                    onAllotted={(a) => void update(a, { allottedLots: a.lots })}
                  />
                ))}
              </Glass>
            )}
          </section>
        );
      })}

      {outside.length ? (
        <section aria-label="Not in this round" className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[14px] font-semibold">Not in this round</span>
            <Badge>{outside.length}</Badge>
            <span className="text-[12.5px] text-orv-muted">add them as you ask</span>
          </div>
          <Glass level="pane" className="flex flex-col divide-y divide-orv-edge p-1.5">
            {outside.map((x) => (
              <div key={x.partner.id} className="flex flex-wrap items-center gap-3 px-2.5 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`Pick ${x.partner.name}`}
                  checked={picked.has(x.partner.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(x.partner.id);
                    else next.delete(x.partner.id);
                    setPicked(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium">{x.partner.name}</p>
                  <Record x={x} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => void move([x.partner.id], 'to_ask')}>
                  <UserPlus size={13} /> Add
                </Button>
                {x.partner.phone ? (
                  <Button size="sm" variant="primary" onClick={() => message(x.partner.id, 'ask')}>
                    <MessageCircle size={13} /> Ask
                  </Button>
                ) : null}
              </div>
            ))}
          </Glass>
        </section>
      ) : null}

      {!r.roster.length ? (
        <Glass level="pane" className="p-6 text-center">
          <p className="text-[15px] font-semibold">No partners yet</p>
          <p className="mt-1 text-small text-orv-muted">
            Add the people whose accounts you apply from in{' '}
            <Link href="/ipo?tab=pool" className="text-orv-accent underline">
              the Pool
            </Link>
            .
          </p>
        </Glass>
      ) : null}

      {/* many at once */}
      {picked.size ? (
        <div className="glass-float edge-light fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-[18px] p-2.5 shadow-lg lg:bottom-5">
          <span className="px-2 text-[13.5px] font-semibold">{picked.size} picked</span>
          <select
            aria-label="Move the picked people to"
            className="h-9 rounded-orv-md border border-orv-edge bg-transparent px-2 text-[13px]"
            value=""
            onChange={(e) => e.target.value && void move(pickedIds, e.target.value)}
          >
            <option value="">Move to…</option>
            {MENU_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_WORD[st]}
              </option>
            ))}
          </select>
          {pickedHavePhones.length ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setQueue({ kind: 'ask', ids: pickedHavePhones })}
            >
              <MessageCircle size={13} /> WhatsApp {pickedHavePhones.length}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} aria-label="Clear the picks">
            <X size={14} />
          </Button>
        </div>
      ) : null}

      {queue ? (
        <QueueSheet
          roundId={r.id}
          kind={queue.kind}
          ids={queue.ids}
          onKind={(k) => setQueue({ ...queue, kind: k })}
          onClose={() => {
            setQueue(null);
            setPicked(new Set());
            void load();
          }}
        />
      ) : null}
      {templates ? (
        <TemplatesSheet
          sample={r.roster[0]?.partner.name ?? 'Ravi'}
          r={r}
          onClose={() => setTemplates(false)}
        />
      ) : null}
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

function Record({ x }: { x: RosterRow }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-orv-muted">
      {trackRecord(x.record)}
      {x.record.missedLast && x.record.lastMissed ? (
        <Badge tone="warning">missed {x.record.lastMissed} last time</Badge>
      ) : null}
    </p>
  );
}

/** One person: where they are, the next step, the status menu, Undo. */
function PersonRow({
  x,
  a,
  picked,
  onPick,
  onMove,
  onMessage,
  onUndo,
  onRemove,
  onFund,
  onSale,
  onSettle,
  onAllotted,
}: {
  x: RosterRow;
  a: App | undefined;
  picked: boolean;
  onPick(on: boolean): void;
  onMove(status: string): void;
  onMessage(k: MessageKind): void;
  onUndo(a: App): void;
  onRemove(): void;
  onFund(a: App): void;
  onSale(a: App): void;
  onSettle(a: App): void;
  onAllotted(a: App): void;
}) {
  const actions = nextActions(x.status, !!x.partner.phone);
  return (
    <div role="group" aria-label={x.partner.name} className="flex flex-col gap-2 px-2.5 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Pick ${x.partner.name}`}
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
            <span className="truncate">{x.partner.name}</span>
            <span className="text-[12px] font-normal text-orv-muted">
              {STATUS_WORD[x.status ?? ''] ?? ''}
            </span>
            {a?.reportedBy === 'partner' ? <Badge tone="accent">said so themselves</Badge> : null}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-orv-muted">
            {a ? (
              <span>
                {a.lots} lot{a.lots > 1 ? 's' : ''} · {m(a.amountMinor)}
              </span>
            ) : null}
            <Record x={x} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((act) => (
            <Button
              key={act.label}
              size="sm"
              variant={act.primary ? 'primary' : 'ghost'}
              onClick={() =>
                act.message
                  ? onMessage(act.message)
                  : act.status === 'allotted' && a
                    ? onAllotted(a)
                    : act.status && onMove(act.status)
              }
            >
              {act.message ? (
                <MessageCircle size={13} />
              ) : act.status === 'applied' ? (
                <Check size={13} />
              ) : null}
              {act.label}
            </Button>
          ))}
          {a?.status === 'allotted' ? (
            <Button size="sm" variant="primary" onClick={() => onSale(a)}>
              Sold…
            </Button>
          ) : null}
          {a?.status === 'sold' ? (
            <Button size="sm" variant="primary" onClick={() => onSettle(a)}>
              Settle
            </Button>
          ) : null}
          {a?.canUndo ? (
            <Button size="sm" variant="ghost" onClick={() => onUndo(a)} aria-label={`Undo ${x.partner.name}`}>
              <RotateCcw size={13} />
            </Button>
          ) : null}
          {a && !['sold', 'settled'].includes(a.status) ? (
            <select
              aria-label={`Status of ${x.partner.name}`}
              className="h-8 cursor-pointer rounded-orv-md border border-orv-edge bg-transparent px-1.5 text-[13px] text-orv-muted"
              value=""
              title="Set any status"
              onChange={(e) => {
                if (e.target.value === '__remove') onRemove();
                else if (e.target.value) onMove(e.target.value);
              }}
            >
              <option value="">⋯</option>
              {MENU_STATUSES.filter((st) => st !== a.status).map((st) => (
                <option key={st} value={st}>
                  {STATUS_WORD[st]}
                </option>
              ))}
              <option value="__remove">Take out of this round</option>
            </select>
          ) : null}
        </div>
      </div>
      {a && ['planned', 'funded'].includes(a.status) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-orv-md bg-orv-track/70 px-3 py-2 text-[13px]">
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
            <Button size="sm" variant="primary" onClick={() => onFund(a)}>
              <Send size={13} /> Record transfer
            </Button>
          ) : null}
        </div>
      ) : null}
      {a && a.gainMinor !== null ? (
        <div className="grid grid-cols-3 gap-3 rounded-orv-md bg-orv-track/50 px-3 py-2">
          <Stat k={`Gain at ₹${a.soldPrice}`} v={m(a.gainMinor)} />
          <Stat k="Their share" v={m(a.shareMinor ?? 0)} />
          <Stat k="They send back" v={a.backMinor === null ? '—' : m(a.backMinor)} />
        </div>
      ) : null}
      {a?.status === 'not_allotted' ? (
        <p className="pl-7 text-[12.5px] text-orv-muted">
          Their {m(a.amountMinor)} stays with them as float for the next IPO.
        </p>
      ) : null}
    </div>
  );
}

/** At the close: who got their bid in, whose mandate is still pending, who missed. */
function CloseSummary({ r }: { r: Round }) {
  const line = (label: string, names: string[], tone: 'warning' | 'danger' | 'neutral') =>
    names.length ? (
      <p className="text-[13.5px]">
        <Badge tone={tone}>{label}</Badge> <span className="ml-1">{names.join(', ')}</span>
      </p>
    ) : null;
  return (
    <Glass level="float" className="flex flex-col gap-2 p-5">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-orv-muted">Bids closed</p>
      <p className="text-[20px] font-semibold">
        {r.board.applied} applied · {r.board.mandates} mandates
        {r.board.missed.length + r.board.noReply.length
          ? ` · ${r.board.missed.length + r.board.noReply.length} missed`
          : ''}
      </p>
      {line('Mandate pending', r.board.mandatePending, 'warning')}
      {line('Missed', r.board.missed, 'danger')}
      {line('No reply', r.board.noReply, 'neutral')}
      {line('Couldn’t this time', r.board.declined, 'neutral')}
      {!r.board.missed.length && !r.board.noReply.length ? (
        <p className="text-[13.5px] text-orv-success">Everyone who said yes got their bid in. 🎉</p>
      ) : (
        <p className="text-[12.5px] text-orv-muted">They’ll show as “missed last time” in the next round.</p>
      )}
    </Glass>
  );
}

/** One tap per chat: browsers open one window per click, so the queue walks you through them. */
function QueueSheet({
  roundId,
  kind,
  ids,
  onKind,
  onClose,
}: {
  roundId: string;
  kind: MessageKind;
  ids: string[];
  onKind(k: MessageKind): void;
  onClose(): void;
}) {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  useEffect(() => {
    setMsgs(null);
    setSent(new Set());
    void api<Message[]>(`/ipo/pool/rounds/${roundId}/messages`, {
      method: 'POST',
      body: { partnerIds: ids, kind },
    }).then(setMsgs, () => setMsgs([]));
  }, [roundId, ids, kind]);
  const next = msgs?.find((x) => !sent.has(x.partnerId));
  return (
    <Sheet
      open
      onClose={onClose}
      title={`WhatsApp ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`}
      subtitle="Each one opens their chat with the message ready. Send it, come back, tap the next."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(MESSAGE_WORD) as MessageKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              className={cn(
                'h-8 rounded-full border px-3 text-[12.5px]',
                k === kind
                  ? 'border-orv-accent font-medium text-orv-accent'
                  : 'border-orv-edge text-orv-muted',
              )}
            >
              {MESSAGE_WORD[k]}
            </button>
          ))}
        </div>
        {msgs === null ? (
          <p className="text-small text-orv-muted">Writing the messages…</p>
        ) : (
          msgs.map((x) => (
            <div
              key={x.partnerId}
              className={cn(
                'flex flex-col gap-2 rounded-orv-md border p-3',
                next?.partnerId === x.partnerId ? 'border-orv-accent' : 'border-orv-edge',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[14px] font-semibold">{x.name}</span>
                {sent.has(x.partnerId) ? (
                  <Badge tone="success">
                    <Check size={11} /> opened
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant={next?.partnerId === x.partnerId ? 'primary' : 'ghost'}
                    onClick={() => {
                      window.open(x.url, '_blank', 'noopener');
                      setSent(new Set([...sent, x.partnerId]));
                    }}
                  >
                    <MessageCircle size={13} /> Open chat
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[12.5px] text-orv-muted">{x.text}</p>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

/** The messages in my own words, with a live preview (spec 0018 D). */
function TemplatesSheet({ r, sample, onClose }: { r: Round; sample: string; onClose(): void }) {
  const toast = useToast();
  const [t, setT] = useState<{
    templates: Record<MessageKind, string>;
    defaults: Record<MessageKind, string>;
    custom: MessageKind[];
    placeholders: string[];
  } | null>(null);
  const [kind, setKind] = useState<MessageKind>('ask');
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    void api<NonNullable<typeof t>>('/ipo/pool/templates').then((x) => {
      setT(x);
      setDraft(x.templates);
    });
  }, []);
  const lots = 1;
  const amount =
    r.issue.priceMax && r.issue.lotSize ? m(Math.round(r.issue.priceMax * r.issue.lotSize * 100)) : '₹—';
  const sampleVars: Record<string, string> = {
    name: sample.split(' ')[0] ?? sample,
    ipo: r.issue.name,
    lots: String(lots),
    amount,
    closes: r.closesAt ?? 'it closes',
    link: 'https://orvyn.app/p/…',
    upi: 'ravi@okaxis',
    gmp: r.issue.gmp !== null ? `₹${r.issue.gmp}` : 'not out yet',
    back: '₹17,357',
    missedLast: '',
  };
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title="WhatsApp messages"
      subtitle="Write them your way. The {placeholders} fill in for each person."
      footer={
        <Button
          variant="primary"
          disabled={!t}
          onClick={async () => {
            try {
              const body = Object.fromEntries(
                (Object.keys(MESSAGE_WORD) as MessageKind[]).map((k) => [k, draft[k] ?? null]),
              );
              setT(await api('/ipo/pool/templates', { method: 'PUT', body }));
              toast({ title: 'Saved — your words from now on', tone: 'success' });
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t save', tone: 'danger' });
            }
          }}
        >
          Save
        </Button>
      }
    >
      {!t ? (
        <p className="text-small text-orv-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {(Object.keys(MESSAGE_WORD) as MessageKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === kind}
                onClick={() => setKind(k)}
                className={cn(
                  'h-8 rounded-full border px-3 text-[12.5px]',
                  k === kind
                    ? 'border-orv-accent font-medium text-orv-accent'
                    : 'border-orv-edge text-orv-muted',
                )}
              >
                {MESSAGE_WORD[k]}
                {draft[k] !== t.defaults[k] ? ' •' : ''}
              </button>
            ))}
          </div>
          <textarea
            aria-label={`The “${MESSAGE_WORD[kind]}” message`}
            className="min-h-32 rounded-orv-md border border-orv-edge bg-transparent p-3 text-[14px] outline-none focus:border-orv-accent"
            value={draft[kind] ?? ''}
            onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {t.placeholders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDraft({ ...draft, [kind]: `${draft[kind] ?? ''}{${p}}` })}
                className="h-7 rounded-full bg-orv-track px-2.5 font-mono text-[11.5px] text-orv-muted hover:text-orv-text"
              >
                {`{${p}}`}
              </button>
            ))}
            <div className="flex-1" />
            {draft[kind] !== t.defaults[kind] ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft({ ...draft, [kind]: t.defaults[kind] })}
              >
                <RotateCcw size={13} /> ORVYN’s words
              </Button>
            ) : null}
          </div>
          <div className="rounded-orv-md bg-[color-mix(in_srgb,var(--orv-success)_10%,transparent)] p-3">
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-orv-muted">
              Preview · to {sampleVars.name}
            </p>
            <p className="whitespace-pre-wrap text-[14px]">{preview(draft[kind] ?? '', sampleVars)}</p>
          </div>
        </div>
      )}
    </Sheet>
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
