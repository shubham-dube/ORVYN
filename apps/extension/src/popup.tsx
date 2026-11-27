import { phaseAt } from '@orvyn/design-tokens';
import {
  Bell,
  Check,
  ExternalLink,
  FileText,
  LogOut,
  PanelRight,
  Puzzle,
  Search,
  Send,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WEB_URL } from './config';
import { parseSpend } from '@orvyn/money';
import type { FoundDoc, Glance, Request, Status } from './core';
import { DayTab, FillTab, get, PageTab, RecallTab, VaultTab } from './tabs';
import type { VaultView } from './vault';
import './popup.css';

document.documentElement.dataset.phase = phaseAt(new Date());

const ask = (req: Request) => chrome.runtime.sendMessage<Request, Status>(req);
const rupees = (minor: number) => `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
type Tab = 'today' | 'page' | 'fill' | 'vault' | 'recall' | 'day' | 'money' | 'inbox' | 'find';
const spring = { type: 'spring', stiffness: 300, damping: 30 } as const;

function Popup() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'test' | 'disconnect'>(null);
  const refresh = useCallback(async () => setS(await ask({ type: 'status' })), []);
  const [tabChoice, setTab] = useState<Tab | null>(null);
  const [glance, setGlance] = useState<Glance | null>(null);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState(false);
  const [login, setLogin] = useState(false);
  useEffect(() => {
    if (!s?.connected) return;
    // a sign-in page in front: open on the Vault
    get<{ login: boolean }>({ type: 'here' }).then(
      (h) => setLogin(h.login),
      () => undefined,
    );
  }, [s?.connected]);
  useEffect(() => {
    if (!s?.connected) return;
    // a sign-in waiting to be saved is what the popup opened for
    get<VaultView>({ type: 'vault' }).then(
      (v) => setPending(!!v.pending && v.state !== 'off'),
      () => undefined,
    );
  }, [s?.connected, tick]);
  useEffect(() => {
    if (!s?.connected) return;
    void get<Glance>({ type: 'glance' }).then(setGlance, () => undefined);
  }, [s?.connected, tick]);

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
              Keep, fill, find and remember anything on the web.
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
  const can = (k: string) => s.me?.role === 'owner' || !!s.me?.entitlements.includes(k as never);
  const tabs: { id: Tab; label: string }[] = [
    ...(can('today') ? [{ id: 'today' as Tab, label: 'Today' }] : []),
    { id: 'page', label: 'Page' },
    ...(can('fill') ? [{ id: 'fill' as Tab, label: 'Fill' }] : []),
    ...(can('vault') ? [{ id: 'vault' as Tab, label: 'Vault' }] : []),
    { id: 'recall', label: 'Recall' },
    ...(can('activity') ? [{ id: 'day' as Tab, label: 'Day' }] : []),
    ...(can('money') ? [{ id: 'money' as Tab, label: 'Money' }] : []),
    { id: 'inbox', label: 'Inbox' },
    ...(can('library') ? [{ id: 'find' as Tab, label: 'Find' }] : []),
  ];
  // a sign-in to save, or a sign-in page: the Vault; otherwise the day (the Inbox shows its count)
  const first =
    (pending || login) && can('vault') ? 'vault' : can('today') ? 'today' : (tabs[0]?.id ?? 'inbox');
  const tab: Tab = tabChoice ?? first;
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
        {document.documentElement.dataset.surface === 'panel' ? null : (
          <button
            aria-label="Open the side panel"
            className="rounded-full p-2 text-orv-muted hover:bg-orv-track"
            onClick={() =>
              void chrome.windows
                .getCurrent()
                .then((w) => chrome.sidePanel.open({ windowId: w.id! }))
                .then(() => window.close())
            }
          >
            <PanelRight size={16} />
          </button>
        )}
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

      <Capture
        s={s}
        onDone={(r) => {
          setS(r);
          setTick((t) => t + 1);
        }}
      />

      <nav aria-label="Sections" className="mx-4 mt-3 grid grid-cols-5 gap-1 rounded-orv-md bg-orv-track p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'relative flex h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-semibold text-white [background:var(--orv-accent-grad)]'
                : 'relative flex h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium text-orv-muted hover:text-orv-text'
            }
          >
            {t.label}
            {t.id === 'inbox' && unread ? (
              <span
                aria-label={`${unread} new`}
                className={
                  tab === t.id
                    ? 'absolute -right-1 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-orv-danger px-1 text-white text-[9.5px] font-bold leading-none'
                    : 'absolute -right-1 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-bold leading-none text-white [background:var(--orv-accent-grad)]'
                }
              >
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-3">
        {tab === 'today' ? <TodayTab glance={glance} onDone={() => setTick((t) => t + 1)} /> : null}
        {tab === 'money' ? <MoneyTab glance={glance} /> : null}
        {tab === 'find' ? <FindTab /> : null}
        {tab === 'page' ? <PageTab canDrop={can('drop')} canThink={can('assistant')} /> : null}
        {tab === 'fill' ? <FillTab /> : null}
        {tab === 'vault' ? <VaultTab onSaved={() => setTick((t) => t + 1)} /> : null}
        {tab === 'recall' ? <RecallTab /> : null}
        {tab === 'day' ? <DayTab /> : null}
        {tab === 'inbox' ? (
          <section className="halo mx-4 mb-2 p-3" aria-label="Notifications">
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
            <ul
              className={
                document.documentElement.dataset.surface === 'panel'
                  ? 'flex max-h-[calc(100vh-290px)] flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin]'
                  : 'flex max-h-[400px] flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin]'
              }
            >
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
        ) : null}
      </div>

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
  const [busy, setBusy] = useState<null | 'quickAdd' | 'drop' | 'expense'>(null);
  const can = (k: string) => s.me?.role === 'owner' || !!s.me?.entitlements.includes(k as never);
  if (!can('today') && !can('drop')) return null;
  // money in words ("spent 240 on lunch") gets its own button, read by the same rules as everywhere
  const spend =
    can('money') && /₹|\brs\.?\s*\d|\bspent\b|\bpaid\b|\bgot\b.*\d/i.test(text) ? parseSpend(text) : null;
  const go = async (type: 'quickAdd' | 'drop' | 'expense') => {
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
        onKeyDown={(e) =>
          e.key === 'Enter' && void go(spend ? 'expense' : can('today') ? 'quickAdd' : 'drop')
        }
        aria-label="Add or drop"
        placeholder="“call mom tomorrow 6pm”, “spent 240 on lunch”, a link…"
        maxLength={500}
        className="h-10 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px] outline-none focus:border-orv-accent"
      />
      <div className="mt-2 flex gap-2">
        {spend ? (
          <PrimaryButton onClick={() => void go('expense')} busy={busy === 'expense'}>
            <Wallet size={15} aria-hidden /> Add {rupees(spend.amountMinor)}
          </PrimaryButton>
        ) : null}
        {can('today') && !spend ? (
          <PrimaryButton onClick={() => void go('quickAdd')} busy={busy === 'quickAdd'}>
            Add to Today
          </PrimaryButton>
        ) : null}
        {can('drop') ? (
          <button
            onClick={() => void go('drop')}
            disabled={busy !== null}
            className="h-11 flex-1 rounded-orv-md border border-orv-edge text-[14px] font-semibold hover:bg-orv-track"
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

/** Today: what's due and overdue, ticked off right here; today's events. */
function TodayTab({ glance, onDone }: { glance: Glance | null; onDone(): void }) {
  const [gone, setGone] = useState<string[]>([]);
  const g = glance?.today;
  if (!glance) return <Loading />;
  if (!g) return <Empty text="Today isn’t switched on for you." />;
  const tasks = g.tasks.filter((t) => !gone.includes(t.id));
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <section className="halo mx-4 mb-2 p-3" aria-label="Today">
      {g.events.length ? (
        <ul className="mb-2 flex flex-col gap-1">
          {g.events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-orv-md bg-orv-track px-2.5 py-1.5 text-[12px]"
            >
              <span className="tabular-nums font-semibold text-orv-accent">
                {e.start ? time(e.start) : 'All day'}
              </span>
              <span className="truncate">{e.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="flex max-h-[250px] flex-col overflow-y-auto">
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <motion.li
              key={t.id}
              layout
              exit={{ opacity: 0, x: 30 }}
              transition={spring}
              className="flex items-center gap-2.5 rounded-orv-md px-1.5 py-1.5 hover:bg-orv-track"
            >
              <button
                aria-label={`Complete ${t.title}`}
                onClick={async () => {
                  setGone((x) => [...x, t.id]);
                  await ask({ type: 'complete', id: t.id });
                  onDone();
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-orv-edge text-transparent hover:border-orv-accent hover:text-orv-accent"
              >
                <Check size={11} strokeWidth={3} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
              <span
                className={
                  t.overdue ? 'text-[11px] font-semibold text-orv-danger' : 'text-[11px] text-orv-muted'
                }
              >
                {t.overdue ? 'late' : t.dueAt ? time(t.dueAt) : 'today'}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {!tasks.length ? <Empty text="Nothing due today. Enjoy it." /> : null}
      </ul>
    </section>
  );
}

/** Money: the month in two numbers, what waits for a look, the latest entries. */
function MoneyTab({ glance }: { glance: Glance | null }) {
  const g = glance?.money;
  if (!glance) return <Loading />;
  if (!g) return <Empty text="Money isn’t switched on for you." />;
  return (
    <section className="halo mx-4 mb-2 p-3" aria-label="Money">
      <div className="grid grid-cols-2 gap-2">
        <div className="pane p-2.5">
          <p className="text-[11px] text-orv-muted">Spent this month</p>
          <p className="text-[20px] font-semibold tabular-nums">{rupees(g.spentMinor)}</p>
        </div>
        <div className="pane p-2.5">
          <p className="text-[11px] text-orv-muted">Came in</p>
          <p className="text-[20px] font-semibold tabular-nums text-orv-success">{rupees(g.earnedMinor)}</p>
        </div>
      </div>
      {g.toReview ? (
        <a
          href={new URL('/money', WEB_URL).toString()}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block rounded-orv-md bg-orv-track px-2.5 py-1.5 text-[12px] font-medium text-orv-accent"
        >
          {g.toReview} new {g.toReview === 1 ? 'payment' : 'payments'} to look at →
        </a>
      ) : null}
      <ul className="mt-2 flex flex-col">
        {g.recent.map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-1 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]">{t.merchant || t.category || 'Payment'}</p>
              <p className="truncate text-[11px] text-orv-muted">
                {t.category ?? 'Uncategorised'} ·{' '}
                {new Date(t.occurredAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </p>
            </div>
            <span
              className={
                t.direction === 'credit'
                  ? 'text-[13px] font-semibold tabular-nums text-orv-success'
                  : 'text-[13px] font-semibold tabular-nums'
              }
            >
              {t.direction === 'credit' ? '+' : ''}
              {rupees(t.amountMinor)}
            </span>
          </li>
        ))}
        {!g.recent.length ? <Empty text="No payments yet." /> : null}
      </ul>
    </section>
  );
}

/** Find: the Library, searched in plain words. */
function FindTab() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<FoundDoc[] | null>(null);
  useEffect(() => {
    if (!q.trim()) return setFound(null);
    const t = setTimeout(
      () => void get<FoundDoc[]>({ type: 'search', q }).then(setFound, () => setFound([])),
      250,
    );
    return () => clearTimeout(t);
  }, [q]);
  return (
    <section className="halo mx-4 mb-2 p-3" aria-label="Find">
      <label className="flex items-center gap-2 rounded-orv-md border border-orv-edge bg-orv-field px-2.5">
        <Search size={14} className="text-orv-muted" aria-hidden />
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="passport, insurance, rent agreement…"
          aria-label="Search your Library"
          className="h-9 flex-1 bg-transparent text-[13px] outline-none"
        />
      </label>
      <ul className="mt-2 flex max-h-[260px] flex-col overflow-y-auto">
        {(found ?? []).map((d) => (
          <li key={d.id}>
            <a
              href={new URL(`/library?doc=${d.id}`, WEB_URL).toString()}
              target="_blank"
              rel="noreferrer"
              className="flex gap-2 rounded-orv-md px-1.5 py-1.5 hover:bg-orv-track"
            >
              <FileText size={14} className="mt-0.5 shrink-0 text-orv-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{d.title || 'Untitled'}</span>
                <span className="block truncate text-[11px] text-orv-muted">
                  {d.category}
                  {d.expiresOn ? ` · expires ${d.expiresOn}` : ''}
                </span>
              </span>
            </a>
          </li>
        ))}
        {found && !found.length ? <Empty text="Nothing found." /> : null}
      </ul>
    </section>
  );
}

function Loading() {
  return <div className="halo mx-4 mb-2 h-32 animate-pulse" aria-label="Loading" />;
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-4 text-center text-[12px] text-orv-muted">{text}</p>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative min-h-[480px]">{children}</main>;
}

/** The ORVYN mark (the same artwork as the app icons). */
function Orb({ small }: { small?: boolean }) {
  const size = small ? 32 : 64;
  return (
    <img
      src="/icons/icon-128.png"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className="block shrink-0 rounded-[22%]"
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
      className="flex h-11 w-full flex-[2] items-center justify-center gap-2 rounded-orv-md font-semibold text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--orv-accent-from)_35%,transparent)] [background:var(--orv-accent-grad)] disabled:opacity-60"
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
