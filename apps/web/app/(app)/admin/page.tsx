'use client';

import { type AdminUserView, type InviteView, MODULE_KEYS } from '@orvyn/contracts';
import { Copy, Link2, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Badge, Glass, Label, Segmented, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
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

const NAMES: Record<string, string> = {
  today: 'Today',
  drop: 'Drop',
  money: 'Money',
  library: 'Library',
  vault: 'Vault',
  assistant: 'Assistant',
  chat: 'Chat',
  ipo: 'IPO',
  jobs: 'Jobs',
};

export default function AdminPage() {
  const { me } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<'people' | 'invites' | 'audit'>('people');
  useEffect(() => {
    if (me && me.role !== 'owner') router.replace('/');
  }, [me, router]);
  if (me?.role !== 'owner') return null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2">
        <h1 className="text-title font-semibold">People</h1>
        <Segmented<'people' | 'invites' | 'audit'>
          label="Section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'people', label: 'People' },
            { value: 'invites', label: 'Invites' },
            { value: 'audit', label: 'Audit log' },
          ]}
        />
      </div>
      {tab === 'people' ? <People /> : tab === 'invites' ? <Invites /> : <Audit />}
    </div>
  );
}

function People() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const load = useCallback(async () => setUsers(await api<AdminUserView[]>('/admin/users')), []);
  useEffect(() => void load(), [load]);

  const toggle = async (u: AdminUserView, key: string, on: boolean) => {
    const entitlements = on ? [...u.entitlements, key] : u.entitlements.filter((k) => k !== key);
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, entitlements } : x)));
    try {
      await api(`/admin/users/${u.id}/entitlements`, { method: 'PUT', body: { entitlements } });
    } catch {
      toast({ title: 'Couldn’t change access', tone: 'danger' });
      await load();
    }
  };

  return (
    <ul className="flex flex-col gap-4">
      {users.map((u) => (
        <Glass key={u.id} level="pane" className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <Avatar name={u.name || u.email} size={40} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-[15px] font-semibold">
                {u.name || u.email}
                {u.role === 'owner' ? <Badge tone="accent">owner</Badge> : null}
                {u.disabled ? <Badge tone="danger">disabled</Badge> : null}
              </p>
              <p className="truncate text-small text-orv-muted">
                {u.email} ·{' '}
                {u.lastSeenAt ? `seen ${new Date(u.lastSeenAt).toLocaleDateString()}` : 'never signed in'}
              </p>
            </div>
            {u.role !== 'owner' ? (
              <Button
                size="sm"
                variant={u.disabled ? 'secondary' : 'danger'}
                onClick={async () => {
                  await api(`/admin/users/${u.id}/disabled`, {
                    method: 'PUT',
                    body: { disabled: !u.disabled },
                  });
                  await load();
                }}
              >
                <UserX size={14} /> {u.disabled ? 'Enable' : 'Disable'}
              </Button>
            ) : null}
          </div>
          {u.role === 'owner' ? (
            <p className="text-small text-orv-muted">The owner always has every module.</p>
          ) : (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODULE_KEYS.map((k) => (
                <Switch
                  key={k}
                  label={NAMES[k] ?? k}
                  checked={u.entitlements.includes(k)}
                  onChange={(on) => void toggle(u, k, on)}
                />
              ))}
            </div>
          )}
        </Glass>
      ))}
    </ul>
  );
}

function Invites() {
  const toast = useToast();
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [mods, setMods] = useState<string[]>(['today', 'chat']);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setInvites(await api<InviteView[]>('/admin/invites')), []);
  useEffect(() => void load(), [load]);

  return (
    <div className="flex flex-col gap-4">
      <Glass level="pane" className="flex flex-col gap-4 p-5">
        <h2 className="text-heading font-semibold">Invite a friend</h2>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await api<InviteView>('/admin/invites', {
                method: 'POST',
                body: {
                  email: email || undefined,
                  note: note || undefined,
                  entitlements: mods,
                  expiresInDays: 7,
                },
              });
              setLink(r.link ?? null);
              setEmail('');
              setNote('');
              await load();
            } catch {
              toast({ title: 'Couldn’t create the invite', tone: 'danger' });
            } finally {
              setBusy(false);
            }
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
                />
              )}
            </Field>
            <Field label="Note (only you see it)">
              {(id) => (
                <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
              )}
            </Field>
          </div>
          <div>
            <Label className="mb-2 block">What they can use</Label>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODULE_KEYS.map((k) => (
                <Switch
                  key={k}
                  label={NAMES[k] ?? k}
                  checked={mods.includes(k)}
                  onChange={(on) => setMods((m) => (on ? [...m, k] : m.filter((x) => x !== k)))}
                />
              ))}
            </div>
          </div>
          <Button type="submit" variant="primary" size="lg" loading={busy} className="self-start">
            <Link2 size={16} /> Create invite link
          </Button>
        </form>
        {link ? (
          <div className="glass-float flex items-center gap-3 p-3" role="status">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px]" data-testid="invite-link">
              {link}
            </code>
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                toast({ title: 'Link copied — it is shown only once', tone: 'success' });
              }}
            >
              <Copy size={14} /> Copy
            </Button>
          </div>
        ) : null}
      </Glass>
      <ul className="flex flex-col gap-2">
        {invites.map((i) => {
          const expired = new Date(i.expiresAt) < new Date();
          return (
            <li key={i.id} className="glass-pane flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{i.email ?? 'Anyone with the link'}</p>
                <p className="truncate text-small text-orv-muted">
                  {i.note ? `${i.note} · ` : ''}
                  {i.entitlements.map((k) => NAMES[k] ?? k).join(', ') || 'no modules'}
                </p>
              </div>
              {i.usedAt ? (
                <Badge tone="success">joined</Badge>
              ) : expired ? (
                <Badge>expired</Badge>
              ) : (
                <Badge tone="accent">open</Badge>
              )}
              {!i.usedAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/admin/invites/${i.id}`, { method: 'DELETE' });
                    await load();
                  }}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => void api<AuditRow[]>('/admin/audit?limit=200').then(setRows), []);
  return (
    <Glass level="pane" className="overflow-x-auto p-2">
      <table className="w-full text-left text-[13px]">
        <thead className="text-orv-muted">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">What</th>
            <th className="px-3 py-2 font-medium">Target</th>
            <th className="px-3 py-2 font-medium">IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-orv-hairline">
              <td className="tabular whitespace-nowrap px-3 py-2">
                {new Date(r.createdAt).toLocaleString()}
              </td>
              <td className="px-3 py-2 font-mono">{r.action}</td>
              <td className="px-3 py-2 text-orv-muted">{r.targetType ? `${r.targetType}` : '—'}</td>
              <td className="px-3 py-2 font-mono text-orv-muted">{r.ip || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Glass>
  );
}
