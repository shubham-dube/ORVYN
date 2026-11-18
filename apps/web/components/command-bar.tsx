'use client';

import {
  ArrowDownToLine,
  Bell,
  CirclePlus,
  Home,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Wallet,
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

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run(): void | Promise<void>;
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

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => router.push(path);
    const list: Command[] = [
      { id: 'home', label: 'Go to Home', icon: <Home size={16} />, run: go('/') },
      { id: 'settings', label: 'Open Settings', icon: <Settings size={16} />, run: go('/settings') },
      ...(me?.role === 'owner' || me?.entitlements.includes('drop')
        ? [{ id: 'go-drop', label: 'Open Drop', icon: <ArrowDownToLine size={16} />, run: go('/drop') }]
        : []),
      ...(me?.role === 'owner' || me?.entitlements.includes('money')
        ? [{ id: 'go-money', label: 'Open Money', icon: <Wallet size={16} />, run: go('/money') }]
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
  const filtered: Command[] =
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

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const exec = async (c: Command | undefined) => {
    if (!c) return;
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
              <span
                aria-hidden
                className="h-5 w-5 shrink-0 rounded-full [background:radial-gradient(circle_at_35%_30%,white,var(--orv-accent-from)_45%,var(--orv-accent-to))]"
              />
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
            <ul
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
