'use client';

import { VAULT_KINDS } from '@orvyn/contracts';
import { generatePassword, WrongPassphrase, WrongRecoveryKey } from '@orvyn/vault-crypto';
import {
  Check,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  IdCard,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  Unlock,
  Paperclip,
  Sparkles,
  Timer,
  User,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { guess, parseTotp, primary, strength as pwStrength, totpCode, totpLeft } from '@/lib/vault-smart';
import { Glass, Label, Segmented, Sheet, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useVault } from '@/lib/vault';
import {
  FIELDS,
  KIND_LABEL,
  loginsFromCsv,
  subtitle,
  type VaultKind,
  type VaultPayload,
} from '@/lib/vault-items';

export default function VaultPage() {
  return (
    <div data-module="vault">
      <VaultView />
    </div>
  );
}

const ICON: Record<VaultKind, ReactNode> = {
  login: <KeyRound size={17} aria-hidden />,
  card: <CreditCard size={17} aria-hidden />,
  id: <IdCard size={17} aria-hidden />,
  apikey: <ShieldCheck size={17} aria-hidden />,
  recovery: <FileText size={17} aria-hidden />,
  note: <StickyNote size={17} aria-hidden />,
};
const MAX_ATTACH = 200 * 1024;
const RECENT = 'orvyn.vault.recent';

/** Items used recently come first (spec 0015 A2): their ids, on this device only. */
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function touchRecent(id: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 30)));
  } catch {
    /* storage blocked: no order */
  }
}

/** A live one-time code with its countdown; a tap copies it. */
function TotpCode({ secret, compact }: { secret: string; compact?: boolean }) {
  const v = useVault();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(30);
  const t = parseTotp(secret);
  const period = t?.period ?? 30;
  useEffect(() => {
    const tt = parseTotp(secret);
    if (!tt) return;
    let live = true;
    const tick = () => {
      setLeft(totpLeft(tt));
      void totpCode(tt).then((c) => live && setCode(c));
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [secret]);
  if (!t) return null;
  const pretty = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  const frac = left / period;
  return (
    <button
      type="button"
      aria-label={`Copy one-time code ${code}`}
      onClick={(e) => {
        e.stopPropagation();
        void v
          .copySecret(code)
          .then(() => toast({ title: 'Code copied', body: `${left} seconds left on it.` }));
      }}
      className={cn(
        'inline-flex items-center gap-2 rounded-full font-mono tabular-nums',
        compact
          ? 'bg-orv-track px-2 py-0.5 text-[12.5px]'
          : 'bg-orv-track px-3 py-1.5 text-[20px] font-semibold tracking-wider',
        left <= 5 && 'text-orv-danger',
      )}
    >
      <svg
        width={compact ? 12 : 16}
        height={compact ? 12 : 16}
        viewBox="0 0 20 20"
        aria-hidden
        className="-rotate-90"
      >
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${frac * 50.3} 50.3`}
          className="transition-[stroke-dasharray] duration-1000 ease-linear"
        />
      </svg>
      {pretty}
    </button>
  );
}

function VaultView() {
  const v = useVault();
  // the recovery key is shown once, right after setup — even though the vault is already open behind it
  const [recovery, setRecovery] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">Only your devices can open it</span>
          <h1 className="text-title font-semibold">Vault</h1>
        </div>
        {v.status === 'unlocked' ? (
          <Button variant="secondary" size="sm" onClick={v.lock}>
            <Lock size={14} /> Lock now
          </Button>
        ) : null}
      </header>
      {v.status === 'loading' ? <div className="skeleton h-32 rounded-orv-md" /> : null}
      {v.status === 'none' || recovery ? <Setup recovery={recovery} setRecovery={setRecovery} /> : null}
      {v.status === 'locked' && !recovery ? <Locked /> : null}
      {v.status === 'unlocked' && !recovery ? <Open /> : null}
    </div>
  );
}

function strength(p: string): { score: number; label: string } {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p) || p.split(/\s+/).length >= 4) s++;
  return { score: s, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Strong'][s]! };
}

/** First time: a passphrase, then a recovery key that must be saved before going on. */
function Setup({ recovery, setRecovery }: { recovery: string | null; setRecovery(k: string | null): void }) {
  const v = useVault();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const st = strength(pass);
  if (recovery)
    return (
      <Glass level="float" className="flex flex-col gap-4 p-6" aria-label="Recovery key">
        <h2 className="text-heading font-semibold">Save your recovery key</h2>
        <p className="text-small text-orv-muted">
          If you forget your passphrase, this key is the only way back in. ORVYN cannot recover it for you —
          nobody can. It is shown once. Print it or write it down and keep it somewhere safe.
        </p>
        <p
          className="select-all rounded-orv-md field-ring p-4 text-center font-mono text-[18px] tracking-wider"
          data-testid="recovery-key"
        >
          {recovery}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void v.copySecret(recovery)}>
            <Copy size={14} /> Copy (clears in 30 s)
          </Button>
          <Button variant="secondary" onClick={() => printKey(recovery)}>
            <Printer size={14} /> Print
          </Button>
        </div>
        <label className="flex items-start gap-2 text-[14px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          I have saved my recovery key somewhere safe.
        </label>
        <Button variant="primary" disabled={!saved} onClick={() => setRecovery(null)}>
          Open my Vault
        </Button>
      </Glass>
    );
  return (
    <Glass level="float" className="flex flex-col gap-4 p-6">
      <h2 className="text-heading font-semibold">Set up your Vault</h2>
      <p className="text-small text-orv-muted">
        Passwords, cards, IDs, API keys and recovery codes — locked on your device with a passphrase only you
        know. The server, the AI and backups only ever hold scrambled data they cannot read.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pass.length < 10 || pass !== again) return;
          setBusy(true);
          void v
            .setup(pass)
            .then(setRecovery)
            .finally(() => setBusy(false));
        }}
      >
        <Field
          label="Passphrase"
          hint={
            pass
              ? `${st.label}. Use a few words only you would think of.`
              : 'At least 10 characters — a sentence works well.'
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
        </Field>
        <Field label="Again" error={again && again !== pass ? 'These don’t match yet.' : null}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={pass.length < 10 || pass !== again || busy}>
          {busy ? 'Creating…' : 'Create my Vault'}
        </Button>
      </form>
      <p className="text-[12px] text-orv-faint">
        Your passphrase never leaves this device. If you lose it and the recovery key, the contents are gone
        for good.
      </p>
    </Glass>
  );
}

function printKey(key: string) {
  const w = window.open('', '_blank', 'noopener,width=600,height=400');
  if (!w) return;
  w.document.write(
    `<title>ORVYN recovery key</title><body style="font-family:system-ui;padding:32px"><h2>ORVYN Vault recovery key</h2><p>Keep this somewhere safe. Anyone with it and access to your account can open your Vault.</p><p style="font:20px monospace;letter-spacing:2px">${key}</p><p>Printed ${new Date().toLocaleDateString()}</p></body>`,
  );
  w.document.close();
  w.print();
}

function Locked() {
  const v = useVault();
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recover, setRecover] = useState(false);
  return (
    <Glass level="float" className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full text-white [background:var(--orv-accent-grad)]">
          <Lock size={20} aria-hidden />
        </span>
        <div>
          <h2 className="text-heading font-semibold">Vault is locked</h2>
          <p className="text-small text-orv-muted">Enter your passphrase to open it.</p>
        </div>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          v.unlock(pass)
            .catch((err) =>
              setError(
                err instanceof WrongPassphrase ? 'That passphrase isn’t right.' : 'Couldn’t open the Vault.',
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Passphrase" error={error}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoFocus
              autoComplete="current-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={!pass || busy}>
          <Unlock size={14} /> {busy ? 'Opening…' : 'Unlock'}
        </Button>
      </form>
      <button className="self-start text-[13px] text-orv-accent" onClick={() => setRecover(true)}>
        Forgot it? Use my recovery key
      </button>
      <Recover open={recover} onClose={() => setRecover(false)} />
    </Glass>
  );
}

function Recover({ open, onClose }: { open: boolean; onClose(): void }) {
  const v = useVault();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Recover with your key">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          v.unlockWithRecovery(key, pass)
            .then(() => {
              toast({ title: 'Vault opened', body: 'Your new passphrase is set.', tone: 'success' });
              onClose();
            })
            .catch((err) =>
              setError(
                err instanceof WrongRecoveryKey
                  ? 'That recovery key isn’t right.'
                  : 'Couldn’t open the Vault.',
              ),
            );
        }}
      >
        <Field label="Recovery key" error={error}>
          {(id) => (
            <Input
              id={id}
              value={key}
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX-…"
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>
        <Field label="New passphrase" hint="At least 10 characters.">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={!key || pass.length < 10}>
          Open and set the passphrase
        </Button>
      </form>
    </Sheet>
  );
}

function Open() {
  const v = useVault();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | VaultKind>('');
  const [editing, setEditing] = useState<{ id: string | null; payload: VaultPayload } | null>(null);
  const [settings, setSettings] = useState(false);
  const csv = useRef<HTMLInputElement>(null);
  const order = recent();
  const rank = (id: string) => {
    const r = order.indexOf(id);
    return r < 0 ? 999 : r;
  };
  const shown = v.items
    .filter(
      (i) =>
        (!kind || i.payload.kind === kind) &&
        (!q.trim() ||
          `${i.payload.title} ${subtitle(i.payload)} ${i.payload.fields.url ?? ''}`
            .toLowerCase()
            .includes(q.trim().toLowerCase())),
    )
    .sort((a, b) => rank(a.id) - rank(b.id));
  const copy = async (id: string, label: string, value: string) => {
    touchRecent(id);
    await v.copySecret(value);
    toast({ title: `${label} copied`, body: 'The clipboard clears in 30 seconds.' });
  };
  const blank = (k: VaultKind): VaultPayload => ({
    kind: k,
    title: '',
    fields: {},
    notes: '',
    updatedAt: '',
  });

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    const { items, skipped } = loginsFromCsv(await file.text());
    for (const p of items) await v.saveItem(null, p);
    toast({
      title: `Imported ${items.length} login${items.length === 1 ? '' : 's'}`,
      body: skipped
        ? `${skipped} rows skipped. Delete the CSV file now — it holds your passwords in the clear.`
        : 'Delete the CSV file now — it holds your passwords in the clear.',
      tone: 'success',
    });
    if (csv.current) csv.current.value = '';
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Glass level="float" className="flex min-w-48 flex-1 items-center gap-2 p-2">
          <Search size={16} className="ml-1 text-orv-faint" aria-hidden />
          <input
            aria-label="Search the Vault"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Enter copies the first match's main secret: find and go in one step
              const first = shown[0];
              const p = first && primary(first.payload);
              if (e.key === 'Enter' && first && p) void copy(first.id, p.label, p.value);
            }}
            autoFocus
            placeholder="Search — Enter copies the first password"
            className="h-9 flex-1 bg-transparent text-[15px] outline-none placeholder:text-orv-faint"
          />
        </Glass>
        <Button variant="primary" onClick={() => setEditing({ id: null, payload: blank('login') })}>
          <Plus size={14} /> New item
        </Button>
        <Button variant="ghost" onClick={() => setSettings(true)}>
          Settings
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kinds">
        {(['', ...VAULT_KINDS] as const).map((k) => (
          <button
            key={k || 'all'}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-full border px-3 py-1 text-[13px]',
              kind === k ? 'border-orv-accent bg-orv-track' : 'border-orv-edge text-orv-muted',
            )}
          >
            {k ? KIND_LABEL[k] : 'All'}
          </button>
        ))}
      </div>
      {v.unreadable ? (
        <p className="text-small text-orv-warning">
          {v.unreadable} item(s) couldn’t be opened with this key.
        </p>
      ) : null}
      {shown.length ? (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Vault items">
          {shown.map((i) => {
            const p = primary(i.payload);
            const user = i.payload.fields.username;
            return (
              <li
                key={i.id}
                className="glass-pane flex items-center gap-3 p-3 transition-transform hover:-translate-y-0.5"
              >
                <button
                  onClick={() => {
                    touchRecent(i.id);
                    setEditing({ id: i.id, payload: i.payload });
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-[12px] text-[15px] font-semibold text-white [background:var(--orv-accent-grad)]"
                  >
                    {i.payload.kind === 'login' && i.payload.title
                      ? i.payload.title.slice(0, 1).toUpperCase()
                      : ICON[i.payload.kind]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">
                      {i.payload.title || KIND_LABEL[i.payload.kind]}
                    </span>
                    <span className="block truncate text-[12px] text-orv-muted">
                      {KIND_LABEL[i.payload.kind]}
                      {subtitle(i.payload) ? ` · ${subtitle(i.payload)}` : ''}
                    </span>
                  </span>
                </button>
                {i.payload.fields.totp ? <TotpCode secret={i.payload.fields.totp} compact /> : null}
                <span className="flex shrink-0 gap-0.5">
                  {user ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy username for ${i.payload.title}`}
                      onClick={() => void copy(i.id, 'Username', user)}
                    >
                      <User size={14} />
                    </Button>
                  ) : null}
                  {p ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy ${p.label.toLowerCase()} for ${i.payload.title}`}
                      onClick={() => void copy(i.id, p.label, p.value)}
                    >
                      <Copy size={14} />
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Glass className="p-8 text-center">
          <LockOpen size={26} className="mx-auto mb-2 text-orv-accent" aria-hidden />
          <p className="text-[15px] font-medium">
            {v.items.length ? 'Nothing matches.' : 'Your Vault is open and empty.'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-small text-orv-muted">
            {v.items.length
              ? 'Try fewer words.'
              : 'Add a login, a card, an ID, an API key, recovery codes or a secure note. Bring your passwords from Chrome or Bitwarden in Settings.'}
          </p>
        </Glass>
      )}
      <input
        ref={csv}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Import a password CSV"
        onChange={(e) => void importCsv(e.target.files?.[0])}
      />
      <ItemSheet state={editing} onClose={() => setEditing(null)} />
      <VaultSettings
        open={settings}
        onClose={() => setSettings(false)}
        onImport={() => csv.current?.click()}
      />
    </>
  );
}

function SecretRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const v = useVault();
  const toast = useToast();
  const [shown, setShown] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-orv-md bg-orv-track px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] uppercase text-orv-muted">{label}</p>
        <p className="truncate font-mono text-[14px]" data-testid={`secret-${label}`}>
          {secret && !shown ? '••••••••••' : value}
        </p>
      </div>
      <span className="flex shrink-0 gap-1">
        {secret ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Copy ${label}`}
          onClick={() =>
            void v
              .copySecret(value)
              .then(() => toast({ title: `${label} copied`, body: 'The clipboard clears in 30 seconds.' }))
          }
        >
          <Copy size={14} />
        </Button>
      </span>
    </div>
  );
}

function ItemSheet({
  state,
  onClose,
}: {
  state: { id: string | null; payload: VaultPayload } | null;
  onClose(): void;
}) {
  const v = useVault();
  const toast = useToast();
  const [d, setD] = useState<VaultPayload | null>(null);
  const [editing, setEditing] = useState(false);
  const [shownFor, setShownFor] = useState<string | null | undefined>(undefined);
  const key = state ? (state.id ?? 'new') : null;
  if (state && shownFor !== key) {
    setShownFor(key);
    setD(state.payload);
    setEditing(state.id === null);
  }
  if (!state && shownFor !== undefined) setShownFor(undefined);
  if (!state || !d)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const fields = FIELDS[d.kind];
  const set = (k: string, val: string) => setD({ ...d, fields: { ...d.fields, [k]: val } });
  const save = async () => {
    await v.saveItem(state.id, { ...d, title: d.title.trim() || KIND_LABEL[d.kind] });
    toast({ title: 'Saved to your Vault', tone: 'success' });
    onClose();
  };
  const attach = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (f.size > MAX_ATTACH) {
        toast({ title: `${f.name} is too large`, body: 'Attachments up to 200 KB.', tone: 'danger' });
        continue;
      }
      const data = btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
      setD((x) =>
        x ? { ...x, attachments: [...(x.attachments ?? []), { name: f.name, mime: f.type, data }] } : x,
      );
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={state.id ? (editing ? 'Edit item' : d.title || 'Vault item') : 'New Vault item'}
      footer={
        editing || !state.id ? (
          <>
            <Button type="button" variant="ghost" onClick={() => (state.id ? setEditing(false) : onClose())}>
              Cancel
            </Button>
            <Button type="submit" form="vault-item-form" variant="primary">
              <Check size={14} /> Save
            </Button>
          </>
        ) : undefined
      }
    >
      {!editing && state.id ? (
        <div className="flex flex-col gap-2">
          <p className="text-small text-orv-muted">{KIND_LABEL[d.kind]}</p>
          {d.fields.totp && parseTotp(d.fields.totp) ? (
            <div className="flex items-center justify-between rounded-orv-md bg-orv-track px-3 py-2">
              <span className="flex items-center gap-2 text-[12px] uppercase text-orv-muted">
                <Timer size={14} /> One-time code
              </span>
              <TotpCode secret={d.fields.totp} />
            </div>
          ) : null}
          {fields.map((f) => (
            <SecretRow key={f.key} label={f.label} value={d.fields[f.key] ?? ''} secret={f.secret} />
          ))}
          {d.updatedAt ? (
            <p className="pt-1 text-[11.5px] text-orv-faint">
              Last changed{' '}
              {new Date(d.updatedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          ) : null}
          {d.notes ? <SecretRow label="Notes" value={d.notes} secret /> : null}
          {(d.attachments ?? []).map((a) => (
            <a
              key={a.name}
              className="flex items-center gap-2 rounded-orv-md bg-orv-track px-3 py-2 text-[14px] text-orv-accent"
              href={`data:${a.mime || 'application/octet-stream'};base64,${a.data}`}
              download={a.name}
            >
              <Paperclip size={14} aria-hidden /> {a.name}
            </a>
          ))}
          <div className="flex justify-between pt-2">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await v.removeItem(state.id!);
                toast({ title: 'Deleted', body: d.title });
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
            <Button variant="primary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      ) : (
        <form
          id="vault-item-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {!state.id ? (
            <PasteAnything onGuess={(g) => setD({ ...d, kind: g.kind, title: g.title, fields: g.fields })} />
          ) : null}
          {!state.id ? (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind">
              {VAULT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={d.kind === k}
                  onClick={() => setD({ ...d, kind: k, fields: {} })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-orv-md border px-2 py-2.5 text-[12.5px] transition-colors',
                    d.kind === k
                      ? 'border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] text-orv-accent'
                      : 'border-orv-edge text-orv-muted hover:bg-orv-track',
                  )}
                >
                  {ICON[k]}
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          ) : null}
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={d.title}
                maxLength={120}
                onChange={(e) => setD({ ...d, title: e.target.value })}
              />
            )}
          </Field>
          {fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {(id) =>
                f.multiline ? (
                  <textarea
                    id={id}
                    rows={4}
                    value={d.fields[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full rounded-orv-md field-ring p-3 font-mono text-[14px] outline-none"
                  />
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id={id}
                      inputMode={f.inputMode}
                      autoComplete="off"
                      value={d.fields[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                    {f.generate ? (
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label="Generate a password"
                        onClick={() => set(f.key, generatePassword({ length: 20 }))}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    ) : null}
                  </div>
                )
              }
            </Field>
          ))}
          {d.kind === 'login' && d.fields.password ? <StrengthMeter value={d.fields.password} /> : null}
          {d.kind !== 'note' ? (
            <Field label="Notes">
              {(id) => (
                <Input
                  id={id}
                  value={d.notes}
                  maxLength={4000}
                  onChange={(e) => setD({ ...d, notes: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-orv-accent">
              <FileUp size={14} aria-hidden /> Attach a small file
              <input
                type="file"
                hidden
                aria-label="Attach a file"
                onChange={(e) => void attach(e.target.files)}
              />
            </label>
            {(d.attachments ?? []).map((a) => (
              <span
                key={a.name}
                className="inline-flex items-center gap-1 rounded-full bg-orv-track px-2 py-0.5 text-[12px]"
              >
                {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setD({ ...d, attachments: (d.attachments ?? []).filter((x) => x !== a) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </form>
      )}
    </Sheet>
  );
}

function StrengthMeter({ value }: { value: string }) {
  const s = pwStrength(value);
  return (
    <div className="-mt-1 flex items-center gap-2" aria-label={`Password strength: ${s.label}`}>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              n <= s.score
                ? s.score <= 1
                  ? 'bg-orv-danger'
                  : s.score === 2
                    ? 'bg-orv-warning'
                    : 'bg-orv-success'
                : 'bg-orv-track',
            )}
          />
        ))}
      </div>
      <span className="text-[12px] text-orv-muted">{s.label}</span>
    </div>
  );
}

/** Paste a card, a login, a key, codes or an otpauth link: the form fills itself (on this device only). */
function PasteAnything({ onGuess }: { onGuess(g: NonNullable<ReturnType<typeof guess>>): void }) {
  const [text, setText] = useState('');
  const g = text.trim() ? guess(text) : null;
  return (
    <div className="rounded-orv-md border border-dashed border-orv-accent/50 bg-[color-mix(in_srgb,var(--orv-accent)_5%,transparent)] p-2.5">
      <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-orv-accent">
        <Sparkles size={13} /> Paste anything
      </label>
      <textarea
        aria-label="Paste anything"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A card, netflix me@mail.com p4ss, an API key, backup codes, an otpauth:// link"
        className="mt-1 w-full resize-none bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-orv-faint"
      />
      {g ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-[12.5px] text-orv-muted">Looks like: {g.found}</span>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => {
              onGuess(g);
              setText('');
            }}
          >
            Fill it in
          </Button>
        </div>
      ) : null}
      <p className="mt-1 text-[11px] text-orv-faint">
        Understood on this device. Never sent anywhere, never to the AI.
      </p>
    </div>
  );
}

function VaultSettings({ open, onClose, onImport }: { open: boolean; onClose(): void; onImport(): void }) {
  const v = useVault();
  const toast = useToast();
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Vault settings">
      <div className="flex flex-col gap-5">
        <div>
          <Label>Lock automatically</Label>
          <div className="mt-2">
            <Segmented
              label="Auto-lock"
              value={String(v.autoLockMin)}
              onChange={(m) => v.setAutoLockMin(Number(m))}
              options={[
                { value: '1', label: '1 min' },
                { value: '5', label: '5 min' },
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
                { value: '0', label: 'Never' },
              ]}
            />
          </div>
          <p className="mt-1 text-[12px] text-orv-faint">
            After this long without use, the Vault locks and the key leaves memory.
          </p>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            v.changePassphrase(oldP, newP)
              .then(() => {
                toast({
                  title: 'Passphrase changed',
                  body: 'Your items didn’t need re-locking.',
                  tone: 'success',
                });
                setOldP('');
                setNewP('');
              })
              .catch((err) =>
                setError(
                  err instanceof WrongPassphrase
                    ? 'That current passphrase isn’t right.'
                    : 'Couldn’t change it.',
                ),
              );
          }}
        >
          <Label>Change passphrase</Label>
          <Field label="Current passphrase" error={error}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={oldP}
                onChange={(e) => setOldP(e.target.value)}
              />
            )}
          </Field>
          <Field label="New passphrase" hint="At least 10 characters.">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={newP}
                onChange={(e) => setNewP(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={!oldP || newP.length < 10}>
            Change passphrase
          </Button>
        </form>
        <div>
          <Label>Import</Label>
          <p className="mb-2 mt-1 text-small text-orv-muted">
            Logins from a Chrome, Edge or Bitwarden CSV export. The file holds passwords in the clear: delete
            it afterwards.
          </p>
          <Button variant="secondary" onClick={onImport}>
            <FileUp size={14} /> Import a CSV
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
