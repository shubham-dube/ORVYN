'use client';

import { KeyRound, Mail, Sparkles, SquareDot } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Glass, Sheet, SkeletonRows, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { useTodayMaybe } from '@/lib/today';

const sel = 'h-10 w-full rounded-orv-md field-ring px-3 text-[14px] outline-none focus:border-orv-accent';

// ------------------------------------------------------------------ connect a mailbox (Zoho, Outlook, any IMAP)

export interface MailPreset {
  id: string;
  name: string;
  help: string;
}

/** Connect a mailbox with an app password; Zoho first because that is what most people here use. */
export function MailSheet({
  open,
  presets,
  onClose,
  onDone,
}: {
  open: boolean;
  presets: MailPreset[];
  onClose(): void;
  onDone(account: string): Promise<void>;
}) {
  const [provider, setProvider] = useState('zoho');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const preset = presets.find((p) => p.id === provider);
  const ok =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    password.trim().length >= 4 &&
    (provider !== 'custom' || host.trim().length > 3);
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ account: string }>('/connections/mail', {
        method: 'POST',
        body: {
          provider,
          email: email.trim(),
          password,
          ...(provider === 'custom' ? { host: host.trim() } : {}),
        },
      });
      setPassword('');
      await onDone(r.account);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Couldn’t reach the mailbox. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Connect a mailbox"
      subtitle="Unread mail next to Gmail, and mail into tasks. Read-only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void submit()}>
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
        <Field label="Provider">
          {(id) => (
            <select id={id} className={sel} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {preset ? (
          <p className="rounded-orv-md bg-orv-track px-3 py-2 text-[12.5px] leading-relaxed text-orv-muted">
            {preset.help}
          </p>
        ) : null}
        <Field label="Email address">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          )}
        </Field>
        {provider === 'custom' ? (
          <Field label="IMAP host" hint="Port 993 with TLS.">
            {(id) => (
              <Input
                id={id}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="imap.example.com"
              />
            )}
          </Field>
        ) : null}
        <Field
          label="App password"
          hint="Not your normal password: an app password made for ORVYN."
          error={problem}
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <p className="text-[12px] text-orv-faint">
          Sealed on the server. ORVYN only reads: nothing is marked read, moved or sent. Revoke the app
          password any time.
        </p>
      </form>
    </Sheet>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ------------------------------------------------------------------ mail (dashboard), and mail into tasks

interface MailItem {
  id: string;
  from: string;
  subject: string;
  snippet?: string;
  url: string | null;
}
interface MailBox {
  connectionId: string;
  account: string;
  provider: string;
  unread: number;
  items: MailItem[];
  problem?: string;
}

/** Unread mail across Gmail and every connected mailbox; nothing shows when none is connected. */
export function MailCard() {
  const [boxes, setBoxes] = useState<MailBox[] | null>(null);
  const [making, setMaking] = useState<MailItem | null>(null);
  const today = useTodayMaybe();
  useEffect(() => {
    api<MailBox[]>('/connections/mail')
      .then(setBoxes)
      .catch(() => setBoxes([]));
  }, []);
  if (!boxes?.length) return null;
  const total = boxes.reduce((a, b) => a + b.unread, 0);
  const items = boxes
    .flatMap((b) => b.items.map((i) => ({ ...i, account: b.account, key: `${b.connectionId}-${i.id}` })))
    .slice(0, 6);
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-5" aria-label="Mail">
      <div className="flex items-center gap-2">
        <Mail size={15} className="text-orv-accent" aria-hidden />
        <h2 className="flex-1 text-[14px] font-semibold">Mail</h2>
        <span className="text-[12px] text-orv-muted">
          {total} unread{boxes.length > 1 ? ` · ${boxes.length} mailboxes` : ''}
        </span>
      </div>
      {boxes
        .filter((b) => b.problem)
        .map((b) => (
          <p key={b.connectionId} className="text-[12px] text-orv-danger">
            {b.account}: {b.problem}
          </p>
        ))}
      {!items.length ? (
        <p className="text-small text-orv-muted">Inbox zero. Nothing unread this week.</p>
      ) : null}
      <ul className="flex flex-col">
        {items.map((m) => (
          <li
            key={m.key}
            className="group flex items-center gap-2 rounded-orv-md px-1 py-1.5 hover:bg-orv-track"
          >
            <a href={m.url ?? undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{m.subject}</p>
              <p className="truncate text-[12px] text-orv-muted">
                {m.from.replace(/<.*>/, '').trim() || m.from}
                {boxes.length > 1 ? ` · ${m.account}` : ''}
              </p>
            </a>
            {today ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Make a task: ${m.subject}`}
                onClick={() => setMaking(m)}
              >
                <SquareDot size={14} /> Task
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {making && today ? <MailTaskSheet mail={making} onClose={() => setMaking(null)} /> : null}
    </Glass>
  );
}

interface Proposal {
  title: string;
  dueDate: string | null;
  dueAt: string | null;
  notes: string;
  smart: boolean;
}

/** A mail as a task: ORVYN fills it (rules first), the person edits and saves. Nothing is created without Save. */
function MailTaskSheet({ mail, onClose }: { mail: MailItem; onClose(): void }) {
  const today = useTodayMaybe()!;
  const toast = useToast();
  const [p, setP] = useState<Proposal | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const ask = useCallback(
    (smart: boolean) =>
      api<Proposal>('/connections/mail/task', {
        method: 'POST',
        body: { subject: mail.subject, from: mail.from, snippet: mail.snippet ?? '', url: mail.url, smart },
      }),
    [mail],
  );
  useEffect(() => {
    ask(false)
      .then(setP)
      .catch(() =>
        setP({ title: mail.subject, dueDate: null, dueAt: null, notes: `From: ${mail.from}`, smart: false }),
      );
  }, [ask, mail]);
  const smarter = async () => {
    setSmartBusy(true);
    try {
      const r = await ask(true);
      if (!r.smart) toast({ title: 'The AI is off or paused; kept ORVYN’s own reading' });
      setP(r);
    } finally {
      setSmartBusy(false);
    }
  };
  const save = async () => {
    if (!p?.title.trim()) return;
    setBusy(true);
    try {
      await today.addTask({
        title: p.title.trim(),
        dueDate: p.dueAt ? null : p.dueDate,
        dueAt: p.dueAt,
        notes: p.notes,
        source: 'email',
      });
      toast({ title: 'Task added', body: p.title, tone: 'success' });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Make a task"
      subtitle={mail.subject}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!p?.title.trim()} onClick={() => void save()}>
            Save task
          </Button>
        </>
      }
    >
      {p === null ? (
        <SkeletonRows rows={3} icon={false} label="Reading the mail" />
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Task">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={p.title}
                onChange={(e) => setP({ ...p, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Due day" hint={p.dueAt ? `At ${new Date(p.dueAt).toLocaleString()}` : undefined}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={p.dueAt ? localDate(new Date(p.dueAt)) : (p.dueDate ?? '')}
                onChange={(e) => setP({ ...p, dueDate: e.target.value || null, dueAt: null })}
              />
            )}
          </Field>
          <Field label="Notes">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className="w-full rounded-orv-md field-ring px-3 py-2 text-[14px] outline-none focus:border-orv-accent"
                value={p.notes}
                onChange={(e) => setP({ ...p, notes: e.target.value })}
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              loading={smartBusy}
              disabled={p.smart}
              onClick={() => void smarter()}
            >
              <Sparkles size={14} /> {p.smart ? 'Read by AI' : 'Read it smarter'}
            </Button>
            <span className="text-[12px] text-orv-faint">Uses the cheapest model; you still decide.</span>
          </div>
        </form>
      )}
    </Sheet>
  );
}
