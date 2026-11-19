'use client';

import { type AdminUserView, type InviteView, MODULE_KEYS } from '@orvyn/contracts';
import {
  BookOpen,
  Briefcase,
  CalendarCheck,
  Check,
  Copy,
  Inbox,
  type LucideIcon,
  Link2,
  Lock,
  MessageCircle,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Sunrise,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Empty,
  Glass,
  Label,
  Segmented,
  Sheet,
  Skeleton,
  SkeletonCards,
  SkeletonRows,
  useToast,
} from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string;
  createdAt: string;
}

interface PersonCost {
  ownerId: string | null;
  person: string;
  costUsd: number;
  calls: number;
}

const MODULES: Record<string, { name: string; icon: LucideIcon; blurb: string }> = {
  today: { name: 'Today', icon: CalendarCheck, blurb: 'Tasks and calendar' },
  drop: { name: 'Drop', icon: Inbox, blurb: 'Capture anything' },
  money: { name: 'Money', icon: Wallet, blurb: 'Spending and budgets' },
  library: { name: 'Library', icon: BookOpen, blurb: 'Documents' },
  vault: { name: 'Vault', icon: Lock, blurb: 'Encrypted secrets' },
  assistant: { name: 'Assistant', icon: Sparkles, blurb: 'Ask ORVYN' },
  brief: { name: 'Brief', icon: Sunrise, blurb: 'Morning summary' },
  chat: { name: 'Chat', icon: MessageCircle, blurb: 'Private messages' },
  ipo: { name: 'IPO', icon: TrendingUp, blurb: 'IPO desk' },
  jobs: { name: 'Jobs', icon: Briefcase, blurb: 'Job hunt' },
};
const mod = (k: string) => MODULES[k] ?? { name: k, icon: Sparkles, blurb: '' };

const PRESETS: { label: string; keys: string[] }[] = [
  { label: 'Everyday', keys: ['today', 'drop', 'money', 'library'] },
  { label: 'Only Today', keys: ['today'] },
  { label: 'Everything', keys: [...MODULE_KEYS] },
];

/** "2 min ago", "yesterday", "12 Mar" — people read recency, not timestamps. */
function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never signed in';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'active now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86_400) return 'yesterday';
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const presence = (iso: string | null) => {
  if (!iso) return 'none';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 600 ? 'live' : s < 7 * 86_400 ? 'recent' : 'idle';
};

type Tab = 'people' | 'invites' | 'activity';

export default function AdminPage() {
  const { me } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('people');
  const [inviting, setInviting] = useState(false);
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [invites, setInvites] = useState<InviteView[] | null>(null);
  const [costs, setCosts] = useState<PersonCost[]>([]);

  useEffect(() => {
    if (me && me.role !== 'owner') router.replace('/');
  }, [me, router]);

  const loadUsers = useCallback(async () => setUsers(await api<AdminUserView[]>('/admin/users')), []);
  const loadInvites = useCallback(async () => setInvites(await api<InviteView[]>('/admin/invites')), []);
  useEffect(() => {
    if (me?.role !== 'owner') return;
    void loadUsers().catch(() => setUsers([]));
    void loadInvites().catch(() => setInvites([]));
    api<{ todayByPerson?: PersonCost[] }>('/ai/usage/all?days=1')
      .then((u) => setCosts(u.todayByPerson ?? []))
      .catch(() => setCosts([]));
  }, [me?.role, loadUsers, loadInvites]);

  if (me?.role !== 'owner') return null;

  const openInvites = (invites ?? []).filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date());
  const activeWeek = (users ?? []).filter((u) => presence(u.lastSeenAt) !== 'idle' && u.lastSeenAt).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
        <div>
          <h1 className="text-title font-semibold">People</h1>
          {users ? (
            <p className="text-small text-orv-muted">
              {users.length} {users.length === 1 ? 'person' : 'people'} · {activeWeek} active this week ·{' '}
              {openInvites.length} open {openInvites.length === 1 ? 'invite' : 'invites'}
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-56" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Tab>
            label="Section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'people', label: 'People' },
              { value: 'invites', label: openInvites.length ? `Invites · ${openInvites.length}` : 'Invites' },
              { value: 'activity', label: 'Activity' },
            ]}
          />
          <Button variant="primary" onClick={() => setInviting(true)}>
            <UserPlus size={16} /> Invite someone
          </Button>
        </div>
      </header>

      {tab === 'people' ? (
        <People users={users} costs={costs} reload={loadUsers} setUsers={setUsers} />
      ) : tab === 'invites' ? (
        <Invites invites={invites} reload={loadInvites} onInvite={() => setInviting(true)} />
      ) : (
        <Activity users={users ?? []} />
      )}

      <InviteSheet
        open={inviting}
        onClose={() => setInviting(false)}
        onCreated={async () => {
          await loadInvites();
          setTab('invites');
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- people
function People({
  users,
  costs,
  reload,
  setUsers,
}: {
  users: AdminUserView[] | null;
  costs: PersonCost[];
  reload(): Promise<void>;
  setUsers(f: (l: AdminUserView[] | null) => AdminUserView[] | null): void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = [...(users ?? [])].sort(
      (a, b) =>
        (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) ||
        Number(a.disabled) - Number(b.disabled) ||
        (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
    );
    return t ? list.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(t)) : list;
  }, [users, q]);

  const setAccess = async (u: AdminUserView, entitlements: string[]) => {
    setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, entitlements } : x)) ?? null);
    try {
      await api(`/admin/users/${u.id}/entitlements`, { method: 'PUT', body: { entitlements } });
    } catch {
      toast({ title: 'Couldn’t change access', tone: 'danger' });
      await reload();
    }
  };

  if (!users) return <SkeletonCards count={4} label="Loading people" className="xl:grid-cols-2" />;
  return (
    <div className="flex flex-col gap-3">
      {users.length > 6 ? (
        <label className="glass-pane flex items-center gap-2 px-3">
          <Search size={16} className="text-orv-muted" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find someone"
            aria-label="Find someone"
            className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:text-orv-faint"
          />
        </label>
      ) : null}
      <ul className="grid gap-3 xl:grid-cols-2" aria-label="People">
        {shown.map((u) => (
          <PersonCard
            key={u.id}
            u={u}
            cost={costs.find((c) => c.ownerId === u.id)}
            onAccess={(keys) => void setAccess(u, keys)}
            onDisable={async () => {
              await api(`/admin/users/${u.id}/disabled`, { method: 'PUT', body: { disabled: !u.disabled } });
              toast({
                title: u.disabled
                  ? `${u.name || u.email} can sign in again`
                  : `${u.name || u.email} is paused`,
              });
              await reload();
            }}
          />
        ))}
        {users.length <= 1 ? (
          <li className="flex flex-col items-center justify-center gap-2 rounded-[var(--orv-glass-pane-radius)] border border-dashed border-orv-hairline p-6 text-center">
            <UserPlus className="text-orv-accent" aria-hidden />
            <p className="text-[15px] font-semibold">Just you so far</p>
            <p className="max-w-xs text-small text-orv-muted">
              Invite family or friends and choose exactly which parts of ORVYN they get. Their data stays
              theirs — you never see it.
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function PersonCard({
  u,
  cost,
  onAccess,
  onDisable,
}: {
  u: AdminUserView;
  cost?: PersonCost;
  onAccess(keys: string[]): void;
  onDisable(): Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const owner = u.role === 'owner';
  const p = presence(u.lastSeenAt);
  return (
    <li
      data-testid={`person-${u.email}`}
      className={cn('glass-pane flex flex-col gap-4 p-5 transition-opacity', u.disabled && 'opacity-60')}
    >
      <div className="flex items-center gap-3">
        <span className="relative">
          <Avatar name={u.name || u.email} size={44} />
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--orv-base)]',
              p === 'live' ? 'bg-orv-success' : p === 'recent' ? 'bg-orv-accent' : 'bg-orv-track',
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-[15px] font-semibold">
            <span className="truncate">{u.name || u.email.split('@')[0]}</span>
            {owner ? (
              <Badge tone="accent">
                <ShieldCheck size={11} className="mr-0.5" aria-hidden /> owner
              </Badge>
            ) : null}
            {u.disabled ? <Badge tone="danger">paused</Badge> : null}
          </p>
          <p className="truncate text-small text-orv-muted">{u.email}</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-[13px] font-medium">{ago(u.lastSeenAt)}</p>
          <p className="tabular text-[12px] text-orv-muted">
            {cost ? `AI today $${cost.costUsd.toFixed(3)}` : 'no AI today'}
          </p>
        </div>
      </div>

      {owner ? (
        <p className="rounded-orv-md bg-orv-track px-3 py-2 text-small text-orv-muted">
          You have every module. Nobody — including you — can read another person’s data.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Can use · {u.entitlements.length}</Label>
            <div className="flex gap-1">
              {PRESETS.map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  onClick={() => onAccess(pr.keys)}
                  className="rounded-full px-2 py-0.5 text-[12px] text-orv-muted transition-colors hover:bg-orv-track hover:text-orv-text"
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>
          <ModuleTiles value={u.entitlements} onChange={onAccess} disabled={u.disabled} />
        </div>
      )}

      {!owner ? (
        <div className="flex items-center justify-between gap-2 border-t border-orv-hairline pt-3">
          <p className="text-[12px] text-orv-muted sm:hidden">{ago(u.lastSeenAt)}</p>
          <p className="hidden text-[12px] text-orv-muted sm:block">
            Joined{' '}
            {new Date(u.createdAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
          {confirming ? (
            <span className="flex items-center gap-2">
              <span className="text-[13px]">
                {u.disabled ? 'Let them back in?' : 'Sign them out everywhere?'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                No
              </Button>
              <Button
                size="sm"
                variant={u.disabled ? 'primary' : 'danger'}
                onClick={async () => {
                  await onDisable();
                  setConfirming(false);
                }}
              >
                {u.disabled ? 'Resume' : 'Pause'}
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              {u.disabled ? 'Resume access' : 'Pause access'}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Each module is a tile you tap: icon, name, on/off — readable at a glance, unlike a column of switches. */
function ModuleTiles({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange(keys: string[]): void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {MODULE_KEYS.map((k) => {
        const m = mod(k);
        const on = value.includes(k);
        const Icon = m.icon;
        return (
          <button
            key={k}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={m.name}
            title={m.blurb}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-orv-md border px-1 py-2.5 text-[12px] font-medium transition-all disabled:cursor-not-allowed',
              on
                ? 'border-transparent text-white shadow-[0_6px_16px_-6px_var(--orv-accent)] [background:var(--orv-accent-grad)]'
                : 'border-orv-hairline text-orv-muted hover:border-orv-edge hover:bg-orv-track hover:text-orv-text',
            )}
          >
            <Icon size={18} aria-hidden />
            {m.name}
            {on ? <Check size={11} aria-hidden className="absolute right-1.5 top-1.5 opacity-80" /> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- invites
function InviteSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(): Promise<void>;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [mods, setMods] = useState<string[]>(['today', 'chat']);
  const [days, setDays] = useState(7);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    onClose();
    setTimeout(() => {
      setLink(null);
      setCopied(false);
      setEmail('');
      setNote('');
    }, 250);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<InviteView>('/admin/invites', {
        method: 'POST',
        body: { email: email || undefined, note: note || undefined, entitlements: mods, expiresInDays: days },
      });
      setLink(r.link ?? null);
      await onCreated();
    } catch {
      toast({ title: 'Couldn’t create the invite', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast({ title: 'Link copied — it is shown only once', tone: 'success' });
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={link ? 'Invite ready' : 'Invite someone'}
      subtitle={
        link
          ? 'Send this link. It works once.'
          : 'They get only what you switch on. You never see their data.'
      }
      footer={
        link ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void create()} disabled={!mods.length}>
              <Link2 size={16} /> Create invite link
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 rounded-orv-lg bg-orv-track p-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full text-white [background:var(--orv-accent-grad)]">
              <Check aria-hidden />
            </span>
            <code
              className="w-full break-all rounded-orv-md bg-orv-field px-3 py-2 font-mono text-[13px]"
              data-testid="invite-link"
            >
              {link}
            </code>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
              </Button>
              {typeof navigator !== 'undefined' && 'share' in navigator ? (
                <Button
                  onClick={() =>
                    void navigator
                      .share({ title: 'Join me on ORVYN', text: 'Your invite to ORVYN', url: link })
                      .catch(() => undefined)
                  }
                >
                  <Share2 size={14} /> Share
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-small text-orv-muted">
            {email ? `Only ${email} can use it.` : 'Anyone with the link can use it, once.'} It expires in{' '}
            {days} {days === 1 ? 'day' : 'days'}.
          </p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their email (optional)" hint="Locks the invite to this address">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@example.com"
                  autoFocus
                />
              )}
            </Field>
            <Field label="Note (only you see it)">
              {(id) => (
                <Input
                  id={id}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={120}
                  placeholder="Mum’s phone"
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>What they can use</Label>
              <div className="flex gap-1">
                {PRESETS.map((pr) => (
                  <button
                    key={pr.label}
                    type="button"
                    onClick={() => setMods(pr.keys)}
                    className="rounded-full px-2 py-0.5 text-[12px] text-orv-muted transition-colors hover:bg-orv-track hover:text-orv-text"
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
            </div>
            <ModuleTiles value={mods} onChange={setMods} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Link works for</Label>
            <Segmented<string>
              label="Link works for"
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={[
                { value: '1', label: '1 day' },
                { value: '7', label: '1 week' },
                { value: '30', label: '30 days' },
              ]}
            />
          </div>
        </form>
      )}
    </Sheet>
  );
}

function Invites({
  invites,
  reload,
  onInvite,
}: {
  invites: InviteView[] | null;
  reload(): Promise<void>;
  onInvite(): void;
}) {
  if (!invites) return <SkeletonRows rows={3} label="Loading invites" />;
  if (!invites.length)
    return (
      <Glass level="pane">
        <Empty
          title="No invites yet"
          action={
            <Button variant="primary" onClick={onInvite}>
              <UserPlus size={16} /> Invite someone
            </Button>
          }
        >
          An invite is a one-time link. You choose the modules; they sign in with their own email.
        </Empty>
      </Glass>
    );
  const now = Date.now();
  return (
    <ul className="flex flex-col gap-2" aria-label="Invites">
      {invites.map((i) => {
        const left = new Date(i.expiresAt).getTime() - now;
        const expired = left <= 0;
        const status = i.usedAt ? 'joined' : expired ? 'expired' : 'open';
        return (
          <li
            key={i.id}
            className={cn('glass-pane flex items-center gap-3 p-3', status === 'expired' && 'opacity-60')}
          >
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                status === 'joined' ? 'bg-orv-success/15 text-orv-success' : 'bg-orv-track text-orv-muted',
              )}
            >
              {status === 'joined' ? <Check size={16} aria-hidden /> : <Link2 size={16} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{i.email ?? 'Anyone with the link'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {i.note ? <span className="mr-1 text-small text-orv-muted">{i.note} ·</span> : null}
                {i.entitlements.map((k) => {
                  const Icon = mod(k).icon;
                  return (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full bg-orv-track px-2 py-0.5 text-[11px] text-orv-muted"
                    >
                      <Icon size={11} aria-hidden /> {mod(k).name}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {status === 'joined' ? (
                <Badge tone="success">joined</Badge>
              ) : status === 'expired' ? (
                <Badge>expired</Badge>
              ) : (
                <Badge tone="accent">
                  {left < 86_400_000
                    ? `${Math.max(1, Math.round(left / 3_600_000))} h left`
                    : `${Math.round(left / 86_400_000)} days left`}
                </Badge>
              )}
              {!i.usedAt ? (
                <button
                  type="button"
                  className="text-[12px] text-orv-muted hover:text-orv-danger"
                  onClick={async () => {
                    await api(`/admin/invites/${i.id}`, { method: 'DELETE' });
                    await reload();
                  }}
                >
                  {expired ? 'Remove' : 'Revoke'}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- activity
const ACTIONS: Record<string, string> = {
  'auth.sign_in': 'signed in',
  'auth.sign_out': 'signed out',
  'auth.passkey_added': 'added a passkey',
  'auth.passkey_removed': 'removed a passkey',
  'invite.created': 'created an invite',
  'invite.used': 'joined with an invite',
  'invite.revoked': 'revoked an invite',
  'auth.code_sent': 'asked for a sign-in code',
  'auth.link_approved': 'approved a new device',
  'auth.refresh_reuse': 'had a stolen session blocked',
  'auth.sign_in_failed': 'failed to sign in',
  'user.created': 'joined',
  'user.entitlements_changed': 'changed someone’s access',
  'user.disabled': 'paused someone',
  'user.enabled': 'resumed someone',
  'device.revoked': 'signed a device out',
};
const say = (a: string) => ACTIONS[a] ?? a.replace(/[._]/g, ' ');

function Activity({ users }: { users: AdminUserView[] }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api<AuditRow[]>('/admin/audit?limit=200')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  const who = useMemo(() => new Map(users.map((u) => [u.id, u.name || u.email])), [users]);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = new Map<string, AuditRow[]>();
    for (const r of rows ?? []) {
      const line =
        `${who.get(r.actorId ?? '') ?? 'system'} ${say(r.action)} ${r.action} ${r.ip}`.toLowerCase();
      if (t && !line.includes(t)) continue;
      const day = new Date(r.createdAt).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      });
      out.set(day, [...(out.get(day) ?? []), r]);
    }
    return [...out];
  }, [rows, q, who]);

  if (!rows) return <SkeletonRows rows={6} label="Loading activity" />;
  return (
    <div className="flex flex-col gap-4">
      <label className="glass-pane flex items-center gap-2 px-3">
        <Search size={16} className="text-orv-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by person, action or IP"
          aria-label="Filter activity"
          className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:text-orv-faint"
        />
      </label>
      {!groups.length ? <p className="px-1 text-small text-orv-muted">Nothing here.</p> : null}
      {groups.map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1">
          <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wide text-orv-muted">{day}</h3>
          <Glass level="pane" className="p-1">
            <ol>
              {list.map((r) => {
                const name = who.get(r.actorId ?? '') ?? 'ORVYN';
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-orv-md px-3 py-2 hover:bg-orv-track"
                  >
                    <Avatar name={name} size={26} />
                    <p className="min-w-0 flex-1 truncate text-[14px]">
                      <strong className="font-semibold">{name}</strong> {say(r.action)}
                    </p>
                    <span className="hidden font-mono text-[12px] text-orv-faint sm:inline">
                      {r.ip || ''}
                    </span>
                    <time className="tabular text-[12px] text-orv-muted" dateTime={r.createdAt}>
                      {new Date(r.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                );
              })}
            </ol>
          </Glass>
        </section>
      ))}
    </div>
  );
}
