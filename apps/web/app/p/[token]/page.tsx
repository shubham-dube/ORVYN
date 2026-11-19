'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Badge, Glass } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';

interface Item {
  id: string;
  ipo: string;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  price: number | null;
  lots: number;
  shares: number;
  amount: number;
  status: string;
  allottedLots: number | null;
  soldPrice: number | null;
  gain: number | null;
  yourShare: number | null;
  sendBack: number | null;
}
interface Page {
  partner: string;
  owner: string;
  holds: number;
  blocked: number;
  inShares: number;
  shareRule: { kind: string; value: number };
  items: Item[];
  expiresAt: string;
}

const r = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const day = (d: string | null) =>
  d
    ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : '—';

/** A partner's private page (spec 0010, ADR-0013): no sign-in, only their own IPO items. */
export default function PartnerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [p, setP] = useState<Page | null | 'gone'>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [price, setPrice] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      api<Page>(`/pool-links/${encodeURIComponent(token)}`, { auth: false }).then(setP, () => setP('gone')),
    [token],
  );
  useEffect(() => void load(), [load]);
  const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${id}:${action}`);
    try {
      setP(
        await api<Page>(`/pool-links/${encodeURIComponent(token)}/applications/${id}`, {
          method: 'POST',
          body: { action, ...extra },
          auth: false,
        }),
      );
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 p-4">
      <div className="flex items-center gap-2 pt-2">
        <Logo size={24} />
        <span className="text-[13px] text-orv-muted">IPO</span>
      </div>
      {p === null ? (
        <div className="skeleton h-64 w-full !rounded-[24px]" />
      ) : p === 'gone' ? (
        <Glass level="halo" className="p-6 text-center">
          <h1 className="text-title font-semibold">This link is off</h1>
          <p className="mt-2 text-small text-orv-muted">It expired or was turned off. Ask for a new one.</p>
        </Glass>
      ) : (
        <>
          <header>
            <h1 className="text-title font-semibold">Hi {p.partner} 👋</h1>
            <p className="text-small text-orv-muted">
              Your IPO applications for {p.owner}. Tap what you’ve done.
            </p>
          </header>
          <Glass level="pane" className="grid grid-cols-3 gap-3 p-4 text-center">
            <div>
              <p className="text-[11.5px] uppercase text-orv-muted">You hold</p>
              <p className="text-[18px] font-semibold">{r(p.holds)}</p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase text-orv-muted">Blocked</p>
              <p className="text-[18px] font-semibold">{r(p.blocked)}</p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase text-orv-muted">Your share</p>
              <p className="text-[15px] font-semibold">
                {p.shareRule.kind === 'none'
                  ? '—'
                  : p.shareRule.kind === 'fixed'
                    ? `${r(p.shareRule.value)}`
                    : `${p.shareRule.value}%`}
              </p>
            </div>
          </Glass>
          {!p.items.length ? <p className="text-small text-orv-muted">Nothing to do right now. 🙌</p> : null}
          {p.items.map((i) => (
            <Glass
              key={i.id}
              level="pane"
              as="section"
              aria-label={i.ipo}
              className="flex flex-col gap-3 p-4"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <h2 className="text-[16px] font-semibold">{i.ipo}</h2>
                  <p className="text-[13px] text-orv-muted">
                    {i.lots} lot{i.lots > 1 ? 's' : ''} ({i.shares} shares at ₹{i.price}) · {r(i.amount)}
                  </p>
                </div>
                <Badge tone="accent">{i.status.replace('_', ' ')}</Badge>
              </div>
              {['planned', 'funded'].includes(i.status) ? (
                <>
                  <p className="text-[13.5px]">
                    Apply in your broker app before <strong>{day(i.closeDate)}, 5 pm</strong> at the cut-off
                    price, then accept the UPI mandate in your UPI app.
                  </p>
                  <Button
                    variant="primary"
                    loading={busy === `${i.id}:applied`}
                    onClick={() => void act(i.id, 'applied')}
                  >
                    I applied
                  </Button>
                </>
              ) : null}
              {i.status === 'applied' ? (
                <Button
                  variant="primary"
                  loading={busy === `${i.id}:mandate`}
                  onClick={() => void act(i.id, 'mandate')}
                >
                  I accepted the UPI mandate
                </Button>
              ) : null}
              {['applied', 'mandate'].includes(i.status) ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-orv-muted">Allotment on {day(i.allotmentDate)}.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="ghost" onClick={() => void act(i.id, 'allotted', { lots: 1 })}>
                      🎉 I got it
                    </Button>
                    <Button variant="ghost" onClick={() => void act(i.id, 'not_allotted')}>
                      Not allotted
                    </Button>
                  </div>
                </div>
              ) : null}
              {i.status === 'allotted' ? (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[12.5px] text-orv-muted" htmlFor={`p-${i.id}`}>
                      Sold at (₹ a share) — lists {day(i.listingDate)}
                    </label>
                    <Input
                      id={`p-${i.id}`}
                      inputMode="decimal"
                      value={price[i.id] ?? ''}
                      onChange={(e) => setPrice({ ...price, [i.id]: e.target.value })}
                    />
                  </div>
                  <Button
                    variant="primary"
                    disabled={!Number(price[i.id])}
                    onClick={() => void act(i.id, 'sold', { price: Number(price[i.id]) })}
                  >
                    I sold
                  </Button>
                </div>
              ) : null}
              {i.status === 'sold' && i.gain !== null ? (
                <p className="rounded-orv-md bg-orv-track px-3 py-2 text-[13.5px]">
                  Gain {r(i.gain)} · your share <strong>{r(i.yourShare ?? 0)}</strong> · please send back{' '}
                  <strong>{r(i.sendBack ?? 0)}</strong>.
                </p>
              ) : null}
              {i.status === 'not_allotted' ? (
                <p className="text-[13px] text-orv-muted">
                  Thanks! The money is unblocked in your account — keep it for the next one.
                </p>
              ) : null}
            </Glass>
          ))}
          <p className="pb-6 text-center text-[11.5px] text-orv-faint">
            This page is only for you. It works until {new Date(p.expiresAt).toLocaleDateString()}.
          </p>
        </>
      )}
    </main>
  );
}
