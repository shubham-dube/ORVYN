'use client';

import { formatMoney } from '@orvyn/contracts';
import { use, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Glass } from '@/components/ui/bits';
import { api } from '@/lib/api';

interface Page {
  group: string;
  you: { name: string; balance: number; paid: number; consumed: number };
  yourPlan: { from: string; to: string; amount: number; fromName: string; toName: string; toUpi: string }[];
  members: { name: string; balance: number }[];
  expenses: { title: string; amount: number; date: string; paidBy: string; yourShare: number }[];
  totalMinor: number;
  expiresAt: string;
}

/** A guest's read-only view of a Split group (ADR-0015): no account, their own line first. */
export default function GuestSplitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [p, setP] = useState<Page | null | 'gone'>(null);
  useEffect(() => {
    api<Page>(`/split-links/${encodeURIComponent(token)}`, { auth: false }).then(setP, () => setP('gone'));
  }, [token]);
  const m = formatMoney;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 p-4">
      <div className="flex items-center gap-2 pt-2">
        <Logo size={24} />
        <span className="text-[13px] text-orv-muted">Split</span>
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
            <h1 className="text-title font-semibold">{p.group}</h1>
            <p className="text-small text-orv-muted">
              Hi {p.you.name} · {m(p.totalMinor)} spent together
            </p>
          </header>
          <Glass level="pane" className="p-5 text-center">
            <p className="text-[12px] uppercase tracking-wide text-orv-muted">You</p>
            <p
              className={`text-[28px] font-semibold ${p.you.balance < 0 ? 'text-orv-danger' : 'text-orv-success'}`}
            >
              {p.you.balance === 0
                ? 'All settled 🎉'
                : p.you.balance < 0
                  ? `You owe ${m(-p.you.balance)}`
                  : `You get ${m(p.you.balance)}`}
            </p>
            <p className="text-[12.5px] text-orv-muted">
              you paid {m(p.you.paid)} · your share {m(p.you.consumed)}
            </p>
          </Glass>
          {p.yourPlan.length ? (
            <Glass level="pane" className="flex flex-col gap-2 p-4" aria-label="To settle">
              {p.yourPlan.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-[14px]">
                  <span className="flex-1">
                    {t.fromName} → {t.toName}
                  </span>
                  <strong>{m(t.amount)}</strong>
                  {t.toUpi && t.fromName === p.you.name ? (
                    <a
                      className="text-[13px] text-orv-accent underline"
                      href={`upi://pay?pa=${encodeURIComponent(t.toUpi)}&pn=${encodeURIComponent(t.toName)}&am=${(t.amount / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(p.group)}`}
                    >
                      Pay
                    </a>
                  ) : null}
                </div>
              ))}
            </Glass>
          ) : null}
          <Glass level="pane" className="flex flex-col gap-1 p-4" aria-label="Expenses">
            <h2 className="mb-1 text-[14px] font-semibold">Expenses</h2>
            {p.expenses.map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b border-orv-edge py-2 text-[13.5px] last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="text-[12px] text-orv-muted">paid by {e.paidBy}</span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">{m(e.amount)}</span>
                  {e.yourShare ? (
                    <span className="text-[12px] text-orv-muted">you {m(e.yourShare)}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </Glass>
          <p className="pb-6 text-center text-[11.5px] text-orv-faint">
            Read-only, only for you. Works until {new Date(p.expiresAt).toLocaleDateString()}.
          </p>
        </>
      )}
    </main>
  );
}
