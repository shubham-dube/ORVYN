'use client';

import {
  ArrowDownToLine,
  Bell,
  BookOpen,
  CirclePlus,
  Home,
  KeyRound,
  LockKeyhole,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Wallet,
  Plug,
  Video,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { useToast } from '@/components/ui/bits';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { chipLabel, smartParse, taskFields } from '@/lib/smart-task';
import { useDropMaybe } from '@/lib/drop';
import { localDay, useTodayMaybe } from '@/lib/today';
import { Logo } from '@/components/logo';
import { useVaultMaybe } from '@/lib/vault';
import { subtitle } from '@/lib/vault-items';
import { primary } from '@/lib/vault-smart';
import { openMeeting } from '@/components/connections';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run(): void | Promise<void>;
  /** keep the bar open (e.g. to ask for the Vault passphrase) */
  stay?: boolean;
}

/**
 * Ctrl/⌘-K or the Orb. Today it navigates and controls ORVYN; with Drop and the Assistant it becomes the place
 * where you type or say anything.
 */
export function CommandBar({ open, onClose }: { open: boolean; onClose(): void }) {
  const router = useRouter();
  const { me, signOut } = useSession();
  const { setPreference } = useTheme();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const vault = useVaultMaybe();
  const [unlocking, setUnlocking] = useState(false);
  const [pass, setPass] = useState('');
  const [passError, setPassError] = useState('');
  const [opening, setOpening] = useState(false);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => router.push(path);
    const list: Command[] = [
      { id: 'home', label: 'Go to Home', icon: <Home size={16} />, run: go('/') },
      { id: 'settings', label: 'Open Settings', icon: <Settings size={16} />, run: go('/settings') },
      ...(me?.role === 'owner' || me?.entitlements.includes('today')
        ? [
            {
              id: 'meeting',
              label: 'Schedule a meeting (Google Meet)',
              icon: <Video size={16} />,
              run: openMeeting,
            },
            {
              id: 'connections',
              label: 'Connections: Google, ClickUp…',
              icon: <Plug size={16} />,
              run: go('/settings#connections'),
            },
          ]
        : []),
      ...(me?.role === 'owner' || me?.entitlements.includes('drop')
        ? [{ id: 'go-drop', label: 'Open Drop', icon: <ArrowDownToLine size={16} />, run: go('/drop') }]
        : []),
      ...(me?.role === 'owner' || me?.entitlements.includes('money')
        ? [{ id: 'go-money', label: 'Open Money', icon: <Wallet size={16} />, run: go('/money') }]
        : []),
      ...(me?.role === 'owner' || me?.entitlements.includes('library')
        ? [{ id: 'go-library', label: 'Open Library', icon: <BookOpen size={16} />, run: go('/library') }]
        : []),
      ...(me?.role === 'owner' || me?.entitlements.includes('vault')
        ? [{ id: 'go-vault', label: 'Open Vault', icon: <KeyRound size={16} />, run: go('/vault') }]
        : []),
      {
        id: 'devices',
        label: 'Devices and passkeys',
        icon: <Shield size={16} />,
        run: go('/settings#security'),
      },
      {
        id: 'test',
        label: 'Send me a test notification',
        icon: <Bell size={16} />,
        run: async () => {
          await api('/notifications/test', { method: 'POST' });
        },
      },
      {
        id: 'auto',
        label: 'Light: follow the sun',
        hint: 'Auto',
        icon: <Sparkles size={16} />,
        run: () => setPreference('auto'),
      },
      { id: 'dawn', label: 'Light: dawn', icon: <Sunrise size={16} />, run: () => setPreference('dawn') },
      { id: 'day', label: 'Light: day', icon: <Sun size={16} />, run: () => setPreference('day') },
      { id: 'dusk', label: 'Light: dusk', icon: <Sunset size={16} />, run: () => setPreference('dusk') },
      { id: 'night', label: 'Light: night', icon: <Moon size={16} />, run: () => setPreference('night') },
      { id: 'signout', label: 'Sign out', icon: <LogOut size={16} />, run: signOut },
    ];
    if (me?.role === 'owner')
      list.splice(3, 0, {
        id: 'admin',
        label: 'People and invites',
        hint: 'Admin',
        icon: <Shield size={16} />,
        run: go('/admin'),
      });
    return list;
  }, [router, me, signOut, setPreference]);

  const today = useTodayMaybe();
  const typed = q.trim();
  const matches = commands.filter((c) => c.label.toLowerCase().includes(typed.toLowerCase()));
  // anything typed can become a task, read naturally ("dentist fri 11 for 45m")
  const parsed =
    today && typed.length > 1
      ? smartParse(typed, { timeZone: today.settings?.timeZone, projects: today.projects, literal: [] })
      : null;
  const understood = parsed
    ? parsed.spans.map((sp) => chipLabel(sp, parsed, today!.projects)).join(' · ')
    : '';
  const drop = useDropMaybe();
  // with Drop, anything typed can also be dropped: the AI suggests what it is (task, event, expense, note)
  const dropCmd: Command[] =
    drop && typed.length > 1
      ? [
          {
            id: 'drop',
            label: `Drop “${typed.length > 60 ? `${typed.slice(0, 60)}…` : typed}”`,
            hint: 'Drop',
            icon: <ArrowDownToLine size={16} />,
            run: async () => {
              await drop.dropText(typed, { source: 'orb' });
              toast({ title: 'Dropped', body: 'A suggestion is on its way in Drop.', tone: 'success' });
            },
          },
        ]
      : [];
  // the Assistant takes anything typed as a question; a question is offered first
  const canAsk = me?.role === 'owner' || !!me?.entitlements.includes('assistant');
  const question =
    /\?\s*$|^(what|how|when|where|who|which|why|do|did|does|is|are|can|should|show|find|tell)\b/i.test(typed);
  const askCmd: Command[] =
    canAsk && typed.length > 1
      ? [
          {
            id: 'ask',
            label: `Ask ORVYN “${typed.length > 60 ? `${typed.slice(0, 60)}…` : typed}”`,
            hint: 'Assistant',
            icon: <Sparkles size={16} />,
            run: () => router.push(`/assistant?q=${encodeURIComponent(typed)}`),
          },
        ]
      : [];
  const base: Command[] =
    today && parsed
      ? [
          ...matches,
          {
            id: 'add-task',
            label: `Add “${parsed.title}”${understood ? '' : ' to Today'}`,
            hint: understood || 'Task',
            icon: <CirclePlus size={16} />,
            run: async () => {
              const fields = taskFields(parsed, localDay(new Date()));
              if (parsed.projectName) fields.projectId = await today.addProject(parsed.projectName);
              await today.addTask({ ...fields, source: 'orb' });
              toast({
                title: 'Added to Today',
                body: [parsed.title, understood].filter(Boolean).join(' — '),
                tone: 'success',
              });
            },
          },
          ...dropCmd,
        ]
      : [...matches, ...dropCmd];
  // the Vault, searched as you type (spec 0015 A3): Enter copies the password; locked, it asks for the passphrase here
  const vaultWords = typed.replace(/^(vault|password|pass|pwd)\s*/i, '').toLowerCase();
  const wantsVault = /^(vault|password|pass|pwd)\b/i.test(typed);
  const vaultCmd: Command[] = !vault
    ? []
    : vault.status === 'unlocked' && (vaultWords.length >= 2 || wantsVault)
      ? vault.items
          .filter((i) =>
            `${i.payload.title} ${subtitle(i.payload)} ${i.payload.fields.url ?? ''}`
              .toLowerCase()
              .includes(vaultWords),
          )
          .slice(0, 5)
          .flatMap((i) => {
            const p = primary(i.payload);
            return p
              ? [
                  {
                    id: `vault-${i.id}`,
                    label: `Copy ${p.label.toLowerCase()} · ${i.payload.title}`,
                    hint: subtitle(i.payload) || 'Vault',
                    icon: <KeyRound size={16} />,
                    run: async () => {
                      await vault.copySecret(p.value);
                      toast({ title: `${p.label} copied`, body: 'The clipboard clears in 30 seconds.' });
                    },
                  },
                ]
              : [];
          })
      : vault.status === 'locked' && (wantsVault || typed.length >= 3)
        ? [
            {
              id: 'vault-unlock',
              label:
                wantsVault || !typed ? 'Unlock the Vault to search it' : `Search the Vault for “${typed}”`,
              hint: 'Vault',
              icon: <LockKeyhole size={16} />,
              stay: true,
              run: () => {
                setUnlocking(true);
                setPass('');
                setPassError('');
              },
            },
          ]
        : [];
  const filtered: Command[] = wantsVault
    ? [...vaultCmd, ...base, ...askCmd]
    : question
      ? [...askCmd, ...base, ...vaultCmd]
      : [...vaultCmd.slice(0, 3), ...base, ...askCmd];

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setUnlocking(false);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const exec = async (c: Command | undefined) => {
    if (!c) return;
    if (c.stay) return void c.run();
    onClose();
    try {
      await c.run();
    } catch {
      toast({ title: 'That didn’t work', tone: 'danger' });
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-orv-scrim backdrop-blur-[4px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Ask or do anything"
            initial={{ y: -12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={spring.smooth}
            className="glass-halo edge-light relative w-full max-w-xl overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-orv-hairline px-4">
              <Logo size={20} glyph />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, filtered.length - 1));
                  if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
                  if (e.key === 'Enter') void exec(filtered[active]);
                  if (e.key === 'Escape') onClose();
                }}
                placeholder="Ask or do anything…"
                role="combobox"
                aria-expanded="true"
                aria-controls="orv-commands"
                aria-activedescendant={filtered[active] ? `orv-cmd-${filtered[active].id}` : undefined}
                aria-label="Command"
                className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-orv-faint"
              />
              <kbd className="rounded-md border border-orv-edge px-1.5 font-mono text-[11px] text-orv-muted">
                Esc
              </kbd>
            </div>
            {unlocking && vault ? (
              <form
                className="flex flex-col gap-2 p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setOpening(true);
                  setPassError('');
                  try {
                    await vault.unlock(pass);
                    setPass('');
                    setUnlocking(false);
                    setTimeout(() => input.current?.focus(), 30);
                  } catch {
                    setPassError('That passphrase isn’t right.');
                  } finally {
                    setOpening(false);
                  }
                }}
              >
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <LockKeyhole size={15} className="text-orv-accent" /> Vault passphrase
                </label>
                <input
                  autoFocus
                  type="password"
                  aria-label="Vault passphrase"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setUnlocking(false)}
                  className="h-11 rounded-orv-md field-ring px-3 text-[15px] outline-none"
                />
                {passError ? <p className="text-[12.5px] text-orv-danger">{passError}</p> : null}
                <p className="text-[11.5px] text-orv-faint">
                  Opened on this device only; the Vault locks itself again after a while.
                </p>
                <button
                  type="submit"
                  disabled={!pass || opening}
                  className="h-10 rounded-orv-md bg-[image:var(--orv-accent-grad)] text-[14px] font-semibold text-white disabled:opacity-50"
                >
                  {opening ? 'Opening…' : 'Unlock and search'}
                </button>
              </form>
            ) : null}
            <ul
              hidden={unlocking}
              id="orv-commands"
              role="listbox"
              aria-label="Commands"
              className="max-h-[50vh] overflow-y-auto p-2"
            >
              {filtered.map((c, i) => (
                <li key={c.id} id={`orv-cmd-${c.id}`} role="option" aria-selected={i === active}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void exec(c)}
                    className={cn(
                      'flex h-11 w-full items-center gap-3 rounded-orv-sm px-3 text-left text-[14px]',
                      i === active ? 'bg-orv-track' : '',
                    )}
                  >
                    <span className="text-orv-accent">{c.icon}</span>
                    <span className="flex-1">{c.label}</span>
                    {c.hint ? <span className="text-[12px] text-orv-muted">{c.hint}</span> : null}
                  </button>
                </li>
              ))}
              {!filtered.length ? (
                <li className="px-3 py-6 text-center text-small text-orv-muted">
                  Nothing matches yet. Drop and the Assistant will understand anything you type here.
                </li>
              ) : null}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
