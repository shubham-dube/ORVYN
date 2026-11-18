import { phaseAt } from '@orvyn/design-tokens';
import { Bell, ExternalLink, LogOut, Puzzle, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WEB_URL } from './config';
import type { Request, Status } from './core';
import './popup.css';

document.documentElement.dataset.phase = phaseAt(new Date());

const ask = (req: Request) => chrome.runtime.sendMessage<Request, Status>(req);
const spring = { type: 'spring', stiffness: 300, damping: 30 } as const;

function Popup() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'test' | 'disconnect'>(null);
  const refresh = useCallback(async () => setS(await ask({ type: 'status' })), []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (kind: 'connect' | 'test' | 'disconnect') => {
    setBusy(kind);
    setS(await ask({ type: kind }));
    setBusy(null);
  };

  if (!s)
    return (
      <Shell>
        <p className="p-6 text-small text-orv-muted">Loading…</p>
      </Shell>
    );

  if (!s.connected) {
    return (
      <Shell>
        <div className="halo m-4 flex flex-col items-center gap-4 p-6 text-center">
          <Orb />
          <div>
            <h1 className="text-heading font-semibold">Bring ORVYN into Chrome</h1>
            <p className="mt-1 text-small text-orv-muted">
              Notifications on your desktop, and soon: capture anything from any page.
            </p>
          </div>
          <PrimaryButton busy={busy === 'connect'} onClick={() => void run('connect')}>
            <Puzzle size={16} aria-hidden /> Connect to ORVYN
          </PrimaryButton>
          {s.error && s.error !== 'cancelled' ? (
            <p role="alert" className="text-small text-orv-danger">
              Couldn’t connect. Try again from here.
            </p>
          ) : null}
          <p className="text-[11px] text-orv-faint">
            You’ll approve it on orvyn.dubey.app — no password is typed here.
          </p>
        </div>
      </Shell>
    );
  }

  const unread = s.notifications.filter((n) => !n.readAt).length;
  return (
    <Shell>
      <header className="flex items-center gap-3 px-4 pt-4">
        <Orb small />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{s.me?.name || 'ORVYN'}</p>
          <p className="flex items-center gap-1.5 truncate text-[11px] text-orv-muted">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: s.live ? 'var(--orv-success)' : 'var(--orv-faint)' }}
            />
            {s.live ? 'Live' : 'Reconnecting…'} · {s.me?.email}
          </p>
        </div>
        <a
          href={WEB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open ORVYN"
          className="rounded-full p-2 text-orv-muted hover:bg-orv-track"
        >
          <ExternalLink size={16} />
        </a>
      </header>

      <Capture s={s} onDone={setS} />

      <section className="halo m-4 p-3" aria-label="Notifications">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <Bell size={14} aria-hidden /> Notifications
          </h2>
          {unread ? (
            <span className="rounded-full px-2 text-[11px] font-bold text-white [background:var(--orv-accent-grad)]">
              {unread} new
            </span>
          ) : null}
        </div>
        <ul className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
          <AnimatePresence initial={false}>
            {s.notifications.map((n) => (
              <motion.li
                key={n.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={spring}
                className="pane flex gap-2 p-2.5"
              >
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: n.readAt ? 'transparent' : 'var(--orv-accent)' }}
                />
                <div className="min-w-0 flex-1">
                  <a
                    className="block"
                    href={new URL(n.url ?? '/', WEB_URL).toString()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <p className="truncate text-[13px] font-semibold">{n.title}</p>
                    {n.body ? <p className="line-clamp-2 text-[12px] text-orv-muted">{n.body}</p> : null}
                  </a>
                  {n.actions.some((a) => !a.open) ? (
                    <div
                      className="mt-1.5 flex flex-wrap gap-1"
                      role="group"
                      aria-label={`Actions for ${n.title}`}
                    >
                      {n.actions
                        .filter((a) => !a.open)
                        .map((a) => (
                          <button
                            key={a.id}
                            onClick={() => void ask({ type: 'act', id: n.id, action: a.id }).then(setS)}
                            className={
                              a.id === 'done'
                                ? 'rounded-full px-2 py-0.5 text-[11px] font-semibold text-white [background:var(--orv-accent-grad)]'
                                : 'rounded-full border border-orv-edge px-2 py-0.5 text-[11px] font-medium hover:bg-orv-track'
                            }
                          >
                            {a.label}
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>
                <button
                  aria-label={`Dismiss ${n.title}`}
                  onClick={() => void ask({ type: 'dismiss', id: n.id }).then(setS)}
                  className="h-7 w-7 shrink-0 rounded-full text-orv-muted hover:bg-orv-track"
                >
                  <X size={14} className="mx-auto" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
          {!s.notifications.length ? (
            <li className="px-1 py-4 text-center text-[12px] text-orv-muted">
              All quiet. Nothing needs you.
            </li>
          ) : null}
        </ul>
      </section>

      <section className="pane mx-4 p-3" aria-label="Capture">
        <p className="text-[12px] font-semibold">Capture</p>
        <p className="text-[12px] text-orv-muted">
          Save this page, a selection or a receipt to ORVYN — arrives with Drop.
        </p>
      </section>

      <footer className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => void run('test')}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-orv-muted hover:bg-orv-track"
        >
          <Send size={13} aria-hidden /> Send a test
        </button>
        <button
          onClick={() => void run('disconnect')}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-orv-danger hover:bg-orv-track"
        >
          <LogOut size={13} aria-hidden /> Disconnect
        </button>
      </footer>
    </Shell>
  );
}

/** Quick capture from any page: to Today (read like everywhere else) or to Drop (the AI suggests what it is). */
function Capture({ s, onDone }: { s: Status; onDone(s: Status): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'quickAdd' | 'drop'>(null);
  const can = (k: string) => s.me?.role === 'owner' || !!s.me?.entitlements.includes(k as never);
  if (!can('today') && !can('drop')) return null;
  const go = async (type: 'quickAdd' | 'drop') => {
    if (!text.trim()) return;
    setBusy(type);
    const r = await ask({ type, text });
    setBusy(null);
    onDone(r);
    if (!r.error) setText('');
  };
  return (
    <section className="halo mx-4 mt-4 p-3" aria-label="Capture">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void go(can('today') ? 'quickAdd' : 'drop')}
        aria-label="Add or drop"
        placeholder="“call mom tomorrow 6pm”, “spent 240 on lunch”, a link…"
        maxLength={500}
        className="h-10 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px] outline-none focus:border-orv-accent"
      />
      <div className="mt-2 flex gap-2">
        {can('today') ? (
          <PrimaryButton onClick={() => void go('quickAdd')} busy={busy === 'quickAdd'}>
            Add to Today
          </PrimaryButton>
        ) : null}
        {can('drop') ? (
          <button
            onClick={() => void go('drop')}
            disabled={busy !== null}
            className="h-9 flex-1 rounded-full border border-orv-edge text-[13px] font-semibold hover:bg-orv-track"
          >
            {busy === 'drop' ? 'Dropping…' : 'Drop'}
          </button>
        ) : null}
      </div>
      {s.saved ? (
        <p role="status" className="mt-2 text-[12px] text-orv-success">
          {s.saved}
        </p>
      ) : s.error && s.error !== 'cancelled' ? (
        <p role="alert" className="mt-2 text-[12px] text-orv-danger">
          That didn’t save: {s.error}
        </p>
      ) : null}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative min-h-[480px]">{children}</main>;
}

function Orb({ small }: { small?: boolean }) {
  const size = small ? 32 : 56;
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-full border border-white/55"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 35% 30%, color-mix(in srgb, white 70%, var(--orv-accent-from)), var(--orv-accent-from) 45%, var(--orv-accent-to))',
        boxShadow: '0 0 24px color-mix(in srgb, var(--orv-accent-from) 50%, transparent)',
      }}
    />
  );
}

function PrimaryButton({
  children,
  onClick,
  busy,
}: {
  children: React.ReactNode;
  onClick(): void;
  busy: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={spring}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-orv-md font-semibold text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--orv-accent-from)_35%,transparent)] [background:var(--orv-accent-grad)] disabled:opacity-60"
    >
      {busy ? 'Waiting for approval…' : children}
    </motion.button>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
