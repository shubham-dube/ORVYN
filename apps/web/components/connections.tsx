'use client';

import {
  CalendarDays,
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  Plus,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Glass, Label, Segmented, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

// ------------------------------------------------------------------ data

export interface Connection {
  id: string;
  provider: 'google' | 'clickup' | string;
  account: string;
  status: string;
  capabilities: ('calendar' | 'meet' | 'gmail' | 'tasks')[];
  lastSyncedAt: string | null;
  problem?: string | null;
}
interface Provider {
  id: string;
  name: string;
  gives: string[];
  how: 'oauth' | 'token' | 'soon';
  available: boolean;
  tokenHelp?: string;
}
export interface ClickUpTask {
  id: string;
  connectionId: string;
  account: string;
  workspace: string;
  name: string;
  url: string;
  status: string;
  list: string;
  due: string | null;
  priority: string | null;
}

/** Everything connected, reloadable; null while loading. */
export function useConnections() {
  const [list, setList] = useState<Connection[] | null>(null);
  const load = useCallback(
    () =>
      api<Connection[]>('/connections')
        .then(setList)
        .catch(() => setList([])),
    [],
  );
  useEffect(() => void load(), [load]);
  return { list, reload: load };
}

const CAP: Record<string, { label: string; icon: ReactNode }> = {
  calendar: { label: 'Calendar', icon: <CalendarDays size={12} aria-hidden /> },
  meet: { label: 'Meet', icon: <Video size={12} aria-hidden /> },
  gmail: { label: 'Gmail', icon: <Mail size={12} aria-hidden /> },
  tasks: { label: 'Tasks', icon: <CheckSquare size={12} aria-hidden /> },
};

function ProviderMark({ id, size = 36 }: { id: string; size?: number }) {
  const look: Record<string, { bg: string; ch: string }> = {
    google: { bg: 'linear-gradient(135deg,#4285F4,#34A853 55%,#FBBC05 80%,#EA4335)', ch: 'G' },
    clickup: { bg: 'linear-gradient(135deg,#7B68EE,#FD71AF 60%,#49CCF9)', ch: 'C' },
    outlook: { bg: 'linear-gradient(135deg,#0078D4,#28A8EA)', ch: 'O' },
    notion: { bg: 'linear-gradient(135deg,#111,#555)', ch: 'N' },
    github: { bg: 'linear-gradient(135deg,#24292f,#57606a)', ch: 'GH' },
    slack: { bg: 'linear-gradient(135deg,#4A154B,#E01E5A)', ch: 'S' },
  };
  const l = look[id] ?? { bg: 'var(--orv-accent-grad)', ch: id[0]?.toUpperCase() ?? '?' };
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: l.bg }}
      className="grid shrink-0 place-items-center rounded-[11px] text-[13px] font-bold text-white shadow-sm"
    >
      {l.ch}
    </span>
  );
}

// ------------------------------------------------------------------ settings section

/**
 * Settings → Connections (spec 0007 C2): every account in one place — several Google accounts (Calendar, Meet,
 * optionally Gmail) and ClickUp workspaces — and what is coming next.
 */
export function ConnectionsSection() {
  const toast = useToast();
  const { list, reload } = useConnections();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [adding, setAdding] = useState<Provider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<Provider[]>('/connections/providers')
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  const google = async (o: { hint?: string; gmail?: boolean } = {}) => {
    setBusy(o.hint ? `gmail-${o.hint}` : 'google');
    const q = new URLSearchParams({
      ...(o.hint ? { hint: o.hint } : {}),
      ...(o.gmail ? { gmail: '1' } : {}),
    });
    try {
      const { url } = await api<{ url: string }>(`/calendar/google/start${q.size ? `?${q}` : ''}`, {
        method: 'POST',
      });
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      toast({
        title:
          e instanceof ApiError && e.code === 'google_not_configured'
            ? 'Google isn’t set up on this server yet'
            : 'Couldn’t start connecting',
        tone: 'danger',
      });
    }
  };

  return (
    <Glass level="pane" as="section" className="flex flex-col gap-5 p-5">
      <header id="connections" className="scroll-mt-6">
        <h2 className="text-heading font-semibold">Connections</h2>
        <p className="text-small text-orv-muted">
          Connect as many accounts as you use — several of each. Keys stay on the server, sealed; ORVYN only
          reads and does what you ask.
        </p>
      </header>

      {list === null ? (
        <SkeletonRows rows={2} label="Loading connections" />
      ) : list.length ? (
        <ul className="flex flex-col gap-2" aria-label="Connected accounts">
          {list.map((c) => (
            <li key={c.id} className="glass-pane flex flex-wrap items-center gap-3 p-3">
              <ProviderMark id={c.provider} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{c.account}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.capabilities.map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full bg-orv-track px-2 py-0.5 text-[11px] text-orv-muted"
                    >
                      {CAP[k]?.icon} {CAP[k]?.label ?? k}
                    </span>
                  ))}
                  {c.status !== 'active' ? (
                    <Badge tone="danger">{c.problem ?? 'Needs reconnecting'}</Badge>
                  ) : null}
                </div>
              </div>
              {c.provider === 'google' && !c.capabilities.includes('gmail') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === `gmail-${c.account}`}
                  onClick={() => void google({ hint: c.account, gmail: true })}
                >
                  <Mail size={14} /> Add Gmail
                </Button>
              ) : null}
              {c.provider === 'google' ? (
                <Link href="#calendars" className="text-[13px] text-orv-accent hover:underline">
                  Calendars
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Disconnect ${c.account}`}
                  onClick={async () => {
                    if (!window.confirm(`Disconnect ${c.account}?`)) return;
                    await api(`/connections/${c.id}`, { method: 'DELETE' });
                    toast({ title: 'Disconnected', body: c.account });
                    await reload();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-orv-muted">Nothing connected yet.</p>
      )}

      <div>
        <Label className="mb-2 block">Add an account</Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={p.how === 'soon' || !p.available}
              onClick={() => (p.how === 'oauth' ? void google() : setAdding(p))}
              className={cn(
                'glass-pane flex items-start gap-3 p-3 text-left transition-all',
                p.how === 'soon' || !p.available
                  ? 'cursor-not-allowed opacity-55'
                  : 'hover:-translate-y-0.5 hover:shadow-[var(--orv-shadow)]',
              )}
            >
              <ProviderMark id={p.id} size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {p.name}
                  {p.how === 'soon' ? <Badge>soon</Badge> : !p.available ? <Badge>not set up</Badge> : null}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-orv-muted">
                  {p.gives.join(' · ')}
                </span>
              </span>
              {p.how !== 'soon' && p.available ? (
                busy === 'google' && p.id === 'google' ? null : (
                  <Plus size={16} className="mt-1 text-orv-accent" aria-hidden />
                )
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <TokenSheet
        provider={adding}
        onClose={() => setAdding(null)}
        onDone={async (account) => {
          setAdding(null);
          toast({ title: 'Connected', body: account, tone: 'success' });
          await reload();
        }}
      />
    </Glass>
  );
}

function TokenSheet({
  provider,
  onClose,
  onDone,
}: {
  provider: Provider | null;
  onClose(): void;
  onDone(account: string): Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (!provider) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ account: string }>(`/connections/${provider.id}`, {
        method: 'POST',
        body: { token: token.trim() },
      });
      setToken('');
      await onDone(r.account);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Couldn’t connect. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={!!provider}
      onClose={onClose}
      title={provider ? `Connect ${provider.name}` : ''}
      subtitle={provider?.gives.join(' · ')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={token.trim().length < 10}
            onClick={() => void submit()}
          >
            <KeyRound size={14} /> Connect
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Personal API token" hint={provider?.tokenHelp} error={problem}>
          {(id) => (
            <Input
              id={id}
              value={token}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              placeholder="pk_…"
              className="font-mono"
            />
          )}
        </Field>
        <p className="text-[12px] text-orv-faint">
          Sealed on the server and used only to read your tasks and tick them done. Add another account the
          same way; remove it any time.
        </p>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ meetings

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Schedule a meeting (spec 0007 C2): on any connected Google account, with a Meet link; Google emails the
 * invitations. Attendees are typed as chips; the time is a day, a start and a length.
 */
export function MeetingSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const { list } = useConnections();
  const accounts = useMemo(() => (list ?? []).filter((c) => c.capabilities.includes('meet')), [list]);
  const next = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return d;
  }, []);
  const [accountId, setAccountId] = useState('');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(localDate(next));
  const [time, setTime] = useState(`${pad(next.getHours())}:${pad(next.getMinutes())}`);
  const [minutes, setMinutes] = useState('30');
  const [people, setPeople] = useState<string[]>([]);
  const [typing, setTyping] = useState('');
  const [notes, setNotes] = useState('');
  const [meet, setMeet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    meetUrl: string | null;
    htmlLink: string | null;
    account: string;
  } | null>(null);
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const addPeople = (raw: string) => {
    const found = raw
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => EMAIL.test(x));
    if (found.length) setPeople((p) => [...new Set([...p, ...found])]);
    setTyping('');
  };
  const close = () => {
    onClose();
    setTimeout(() => {
      setDone(null);
      setTitle('');
      setPeople([]);
      setNotes('');
    }, 250);
  };
  const submit = async () => {
    if (typing.trim()) addPeople(typing);
    const start = new Date(`${day}T${time}`);
    const end = new Date(start.getTime() + Number(minutes) * 60_000);
    setBusy(true);
    try {
      const r = await api<{ meetUrl: string | null; htmlLink: string | null; account: string }>(
        '/calendar/meetings',
        {
          method: 'POST',
          body: {
            accountId,
            title: title.trim(),
            start: start.toISOString(),
            end: end.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            attendees: [
              ...new Set([...people, ...(EMAIL.test(typing.trim()) ? [typing.trim().toLowerCase()] : [])]),
            ],
            notes,
            meet,
          },
        },
      );
      setDone(r);
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Couldn’t schedule it', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (list !== null && !accounts.length)
    return (
      <Sheet open={open} onClose={close} title="Schedule a meeting">
        <p className="text-small text-orv-muted">
          Connect a Google account first — then ORVYN can make the Meet link and Google sends the invitations.
        </p>
        <Link href="/settings#connections" onClick={close} className="mt-3 inline-block text-orv-accent">
          Open Connections →
        </Link>
      </Sheet>
    );

  return (
    <Sheet
      open={open}
      onClose={close}
      title={done ? 'Meeting scheduled' : 'Schedule a meeting'}
      subtitle={
        done ? `On ${done.account}. Google is emailing the invitations.` : 'Google sends the invitations.'
      }
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!title.trim() || !accountId}
              onClick={() => void submit()}
            >
              <Video size={15} /> Schedule
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 rounded-orv-lg bg-orv-track p-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full text-white [background:var(--orv-accent-grad)]">
            <Check aria-hidden />
          </span>
          {done.meetUrl ? (
            <>
              <code className="w-full break-all rounded-orv-md bg-orv-field px-3 py-2 font-mono text-[13px]">
                {done.meetUrl}
              </code>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(done.meetUrl!);
                    toast({ title: 'Meet link copied', tone: 'success' });
                  }}
                >
                  <Copy size={14} /> Copy link
                </Button>
                <a href={done.meetUrl} target="_blank" rel="noreferrer">
                  <Button>
                    <Video size={14} /> Join
                  </Button>
                </a>
              </div>
            </>
          ) : null}
          {done.htmlLink ? (
            <a href={done.htmlLink} target="_blank" rel="noreferrer" className="text-[13px] text-orv-accent">
              Open in Google Calendar <ExternalLink size={12} className="inline" />
            </a>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="What">
            {(id) => (
              <Input
                id={id}
                value={title}
                autoFocus
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Design review"
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Day">
              {(id) => <Input id={id} type="date" value={day} onChange={(e) => setDay(e.target.value)} />}
            </Field>
            <Field label="Starts">
              {(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <Label>How long</Label>
            <Segmented
              label="How long"
              value={minutes}
              onChange={setMinutes}
              options={[
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '45', label: '45 min' },
                { value: '60', label: '1 h' },
                { value: '90', label: '1½ h' },
              ]}
            />
          </div>
          <Field label="Who" hint="Type or paste emails; Enter or comma adds each.">
            {(id) => (
              <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-orv-md border border-orv-edge bg-orv-field px-2 py-1.5">
                {people.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full bg-orv-track py-0.5 pl-2.5 pr-1 text-[13px]"
                  >
                    {p}
                    <button
                      type="button"
                      aria-label={`Remove ${p}`}
                      onClick={() => setPeople((xs) => xs.filter((x) => x !== p))}
                      className="grid h-5 w-5 place-items-center rounded-full hover:bg-orv-hairline"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  id={id}
                  value={typing}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/[,;\s]$/.test(v)) addPeople(v);
                    else setTyping(v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && typing.trim()) {
                      e.preventDefault();
                      addPeople(typing);
                    }
                    if (e.key === 'Backspace' && !typing && people.length) setPeople((xs) => xs.slice(0, -1));
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    addPeople(e.clipboardData.getData('text'));
                  }}
                  placeholder={people.length ? '' : 'raj@example.com'}
                  className="h-8 min-w-40 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-orv-faint"
                />
              </div>
            )}
          </Field>
          <details className="group rounded-orv-md border border-orv-hairline px-3 py-2">
            <summary className="cursor-pointer text-[14px] text-orv-muted">More options</summary>
            <div className="mt-3 flex flex-col gap-3">
              {accounts.length > 1 ? (
                <Field label="From account">
                  {(id) => (
                    <select
                      id={id}
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="h-11 rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[15px]"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px]">Add a Google Meet link</span>
                <Switch label="Add a Google Meet link" checked={meet} onChange={setMeet} />
              </div>
              <Field label="Agenda (optional)">
                {(id) => (
                  <textarea
                    id={id}
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-orv-md border border-orv-edge bg-orv-field p-3 text-[15px] outline-none"
                  />
                )}
              </Field>
            </div>
          </details>
          {accounts.length === 1 ? (
            <p className="text-[12px] text-orv-faint">From {accounts[0]!.account}</p>
          ) : null}
        </form>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ ClickUp in Today

/** "From ClickUp": open tasks assigned to you across connected ClickUp accounts; tick to close them there. */
export function ClickUpTasks() {
  const toast = useToast();
  const [tasks, setTasks] = useState<ClickUpTask[] | null>(null);
  const [has, setHas] = useState(false);
  useEffect(() => {
    api<Connection[]>('/connections')
      .then((l) => {
        const yes = l.some((c) => c.provider === 'clickup');
        setHas(yes);
        if (yes)
          api<ClickUpTask[]>('/connections/clickup/tasks')
            .then(setTasks)
            .catch(() => setTasks([]));
      })
      .catch(() => undefined);
  }, []);
  if (!has) return null;
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-4" aria-label="From ClickUp">
      <div className="flex items-center gap-2">
        <ProviderMark id="clickup" size={22} />
        <h2 className="flex-1 text-[14px] font-semibold">From ClickUp</h2>
        {tasks ? <span className="text-[12px] text-orv-muted">{tasks.length} open</span> : null}
      </div>
      {tasks === null ? (
        <SkeletonRows rows={2} icon={false} label="Loading ClickUp tasks" />
      ) : !tasks.length ? (
        <p className="text-small text-orv-muted">Nothing assigned to you. 🎉</p>
      ) : (
        <ul className="flex flex-col">
          {tasks.slice(0, 12).map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-orv-md px-1 py-1.5 hover:bg-orv-track">
              <button
                type="button"
                aria-label={`Done: ${t.name}`}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-orv-edge hover:border-orv-accent"
                onClick={async () => {
                  setTasks((xs) => xs?.filter((x) => x.id !== t.id) ?? null);
                  try {
                    await api(`/connections/clickup/tasks/${encodeURIComponent(t.id)}/complete`, {
                      method: 'POST',
                      body: { connectionId: t.connectionId },
                    });
                    toast({ title: 'Closed in ClickUp', body: t.name, tone: 'success' });
                  } catch {
                    setTasks((xs) => (xs ? [t, ...xs] : xs));
                    toast({ title: 'ClickUp didn’t take it', tone: 'danger' });
                  }
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">{t.name}</p>
                <p className="truncate text-[12px] text-orv-muted">
                  {t.list} · {t.status}
                  {t.due
                    ? ` · due ${new Date(t.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                    : ''}
                </p>
              </div>
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${t.name} in ClickUp`}
                className="text-orv-muted hover:text-orv-accent"
              >
                <ExternalLink size={14} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Glass>
  );
}

// ------------------------------------------------------------------ mail on the dashboard

/** Unread mail across Google accounts with Gmail added; nothing shows when none has it. */
export function MailCard() {
  const [mail, setMail] = useState<
    | {
        account: string;
        unread: number;
        items: { id: string; from: string; subject: string; url: string }[];
      }[]
    | null
  >(null);
  useEffect(() => {
    api<Connection[]>('/connections')
      .then(async (l) => {
        const g = l.filter((c) => c.capabilities.includes('gmail'));
        const boxes = await Promise.all(
          g.map((c) =>
            api<{ unread: number; items: { id: string; from: string; subject: string; url: string }[] }>(
              `/calendar/accounts/${c.id}/inbox`,
            )
              .then((r) => ({ account: c.account, ...r }))
              .catch(() => null),
          ),
        );
        setMail(boxes.filter((b): b is NonNullable<typeof b> => !!b));
      })
      .catch(() => setMail([]));
  }, []);
  if (!mail?.length) return null;
  const total = mail.reduce((a, b) => a + b.unread, 0);
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-5" aria-label="Mail">
      <div className="flex items-center gap-2">
        <Mail size={15} className="text-orv-accent" aria-hidden />
        <h2 className="flex-1 text-[14px] font-semibold">Mail</h2>
        <span className="text-[12px] text-orv-muted">{total} unread</span>
      </div>
      <ul className="flex flex-col">
        {mail
          .flatMap((b) => b.items.map((i) => ({ ...i, account: b.account })))
          .slice(0, 5)
          .map((m) => (
            <li key={m.id}>
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-orv-md px-1 py-1.5 hover:bg-orv-track"
              >
                <p className="truncate text-[14px] font-medium">{m.subject}</p>
                <p className="truncate text-[12px] text-orv-muted">
                  {m.from.replace(/<.*>/, '').trim() || m.from}
                </p>
              </a>
            </li>
          ))}
      </ul>
    </Glass>
  );
}

/** Opens the meeting sheet from anywhere: `openMeeting()` (Today, the command bar, the dashboard). */
export const openMeeting = () => window.dispatchEvent(new CustomEvent('orvyn:meeting'));

export function MeetingHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('orvyn:meeting', on);
    return () => window.removeEventListener('orvyn:meeting', on);
  }, []);
  return open ? <MeetingSheet open onClose={() => setOpen(false)} /> : null;
}
