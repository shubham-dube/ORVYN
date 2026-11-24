'use client';

import {
  ArrowDownToLine,
  Bell,
  BookOpen,
  CheckCircle2,
  Mail,
  Home,
  KeyRound,
  Settings,
  Shield,
  Wallet,
  Sparkles,
  MessagesSquare,
  Receipt,
  Sunrise,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { CommandBar } from '@/components/command-bar';
import { MeetingHost } from '@/components/connections';
import { Wordmark } from '@/components/logo';
import { NotificationCenter } from '@/components/notification-center';
import { Avatar } from '@/components/ui/bits';
import { api } from '@/lib/api';
import { Orb } from '@/components/ui/orb';
import { cn } from '@/lib/cn';
import { NotificationsProvider, useNotifications } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { DropProvider } from '@/lib/drop';
import { LibraryProvider } from '@/lib/library';
import { VaultProvider } from '@/lib/vault';
import { MoneyProvider } from '@/lib/money';
import { SyncProvider } from '@/lib/sync';
import { TodayProvider } from '@/lib/today';
import { useChatDelivery } from '@/lib/chat';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);
  if (status !== 'signedIn') return <Splash />;
  return (
    <NotificationsProvider>
      <SyncProvider>
        <MaybeToday>
          <MaybeMoney>
            <MaybeDrop>
              <MaybeLibrary>
                <MaybeVault>
                  <Shell>{children}</Shell>
                </MaybeVault>
              </MaybeLibrary>
            </MaybeDrop>
          </MaybeMoney>
        </MaybeToday>
      </SyncProvider>
    </NotificationsProvider>
  );
}

/** Today syncs app-wide (so the command bar can add tasks anywhere) — only for people who have it. */
function MaybeToday({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === 'owner' || me?.entitlements.includes('today') ? (
    <TodayProvider>{children}</TodayProvider>
  ) : (
    children
  );
}

function MaybeMoney({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === 'owner' || me?.entitlements.includes('money') ? (
    <MoneyProvider>{children}</MoneyProvider>
  ) : (
    children
  );
}

function MaybeDrop({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === 'owner' || me?.entitlements.includes('drop') ? (
    <DropProvider>{children}</DropProvider>
  ) : (
    children
  );
}

function MaybeLibrary({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === 'owner' || me?.entitlements.includes('library') ? (
    <LibraryProvider>{children}</LibraryProvider>
  ) : (
    children
  );
}

function MaybeVault({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === 'owner' || me?.entitlements.includes('vault') ? (
    <VaultProvider>{children}</VaultProvider>
  ) : (
    children
  );
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Orb size={56} state="thinking" label="Loading" />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me: who } = useSession();
  const { me } = useSession();
  // a message from someone else counts as delivered while ORVYN is open anywhere (spec 0015)
  useChatDelivery(me?.id, !!(who?.role === 'owner' || who?.entitlements.includes('chat')));
  const pathname = usePathname();
  const n = useNotifications();
  const [command, setCommand] = useState(false);
  const [bell, setBell] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommand((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nav = [
    { href: '/', label: 'Home', icon: Home },
    ...(me?.role === 'owner' || me?.entitlements.includes('assistant')
      ? [{ href: '/assistant', label: 'Assistant', icon: Sparkles }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('brief')
      ? [{ href: '/brief', label: 'Brief', icon: Sunrise }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('today')
      ? [
          { href: '/today', label: 'Today', icon: CheckCircle2 },
          { href: '/mail', label: 'Mail', icon: Mail },
        ]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('drop')
      ? [{ href: '/drop', label: 'Drop', icon: ArrowDownToLine }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('money')
      ? [{ href: '/money', label: 'Money', icon: Wallet }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('library')
      ? [{ href: '/library', label: 'Library', icon: BookOpen }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('chat')
      ? [{ href: '/chat', label: 'Chat', icon: MessagesSquare }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('split')
      ? [{ href: '/split', label: 'Split', icon: Receipt }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('ipo')
      ? [{ href: '/ipo', label: 'IPO desk', icon: TrendingUp }]
      : []),
    ...(me?.role === 'owner' || me?.entitlements.includes('vault')
      ? [{ href: '/vault', label: 'Vault', icon: KeyRound }]
      : []),
    { href: '/settings', label: 'Settings', icon: Settings },
    ...(me?.role === 'owner' ? [{ href: '/admin', label: 'People', icon: Shield }] : []),
  ];

  const mailCount = useMailCount(nav.some((x) => x.href === '/mail'));

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1440px] gap-4 p-3 pb-28 sm:p-5 lg:pb-5">
      <aside className="glass-pane sticky top-5 hidden h-[calc(100dvh-40px)] w-60 shrink-0 flex-col p-3 lg:flex">
        <div className="mb-4 flex shrink-0 items-center gap-2.5 px-2 pt-2">
          <Wordmark />
        </div>
        {/* the list scrolls on short screens; you and the bell stay pinned at the bottom */}
        <nav aria-label="Main" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {nav.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={pathname === i.href ? 'page' : undefined}
              className={cn(
                'flex h-10 shrink-0 items-center gap-3 rounded-orv-md px-3 text-[14px] font-medium transition-colors',
                pathname === i.href
                  ? 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-text'
                  : 'text-orv-muted hover:bg-orv-track hover:text-orv-text',
              )}
            >
              <i.icon size={18} aria-hidden className={pathname === i.href ? 'text-orv-accent' : ''} />
              {i.label}
              {i.href === '/mail' && mailCount ? (
                <span
                  className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-orv-accent px-1.5 text-[11px] font-semibold text-white"
                  aria-label={`${mailCount} important`}
                >
                  {mailCount > 99 ? '99+' : mailCount}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => setCommand(true)}
          className="mt-3 flex h-10 shrink-0 items-center gap-2 rounded-orv-md border border-orv-edge px-3 text-[13px] text-orv-muted hover:text-orv-text"
        >
          Ask or do anything
          <kbd className="ml-auto rounded border border-orv-edge px-1 font-mono text-[10px]">Ctrl K</kbd>
        </button>
        <div className="mt-2 flex shrink-0 items-center gap-3 rounded-orv-md p-2">
          <Avatar name={me?.name || me?.email || '?'} src={me?.avatarUrl} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{me?.name || 'You'}</p>
            <p className="truncate text-[11px] text-orv-muted">{me?.email}</p>
          </div>
          <BellButton count={n.unread} onClick={() => setBell(true)} />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mb-3 flex justify-end lg:hidden">
          <BellButton count={n.unread} onClick={() => setBell(true)} />
        </div>
        {children}
      </main>
      <MeetingHost />

      {/* phone dock: one-hand reach, the Orb in the middle */}
      <nav
        aria-label="Main"
        className="glass-float fixed inset-x-3 bottom-3 z-40 grid h-16 grid-cols-5 items-center lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <DockLink href="/" label="Home" active={pathname === '/'} icon={<Home size={20} />} />
        {nav.some((i) => i.href === '/today') ? (
          <DockLink
            href="/today"
            label="Today"
            active={pathname === '/today'}
            icon={<CheckCircle2 size={20} />}
          />
        ) : (
          <span />
        )}
        <span aria-hidden />
        {nav.some((i) => i.href === '/money') ? (
          <DockLink href="/money" label="Money" active={pathname === '/money'} icon={<Wallet size={20} />} />
        ) : (
          <span aria-hidden />
        )}
        <DockLink
          href="/settings"
          label="Settings"
          active={pathname === '/settings'}
          icon={<Settings size={20} />}
        />
      </nav>
      <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 lg:hidden">
        <Orb size={64} onClick={() => setCommand(true)} />
      </div>

      <CommandBar open={command} onClose={() => setCommand(false)} />
      <NotificationCenter open={bell} onClose={() => setBell(false)} />
    </div>
  );
}

function BellButton({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button
      onClick={onClick}
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
      className="glass-pane relative flex h-10 w-10 items-center justify-center !rounded-full"
    >
      <Bell size={18} aria-hidden />
      {count ? (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] text-white [background:var(--orv-accent-grad)]">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </button>
  );
}

function DockLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-16 flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
        active ? 'text-orv-accent' : 'text-orv-muted',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

/** The important mail count for the sidebar (D-0018-6): on open, on focus, and every five minutes. */
function useMailCount(on: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const load = () =>
      void api<{ important: number }>('/inbox/counts').then(
        (c) => setN(c.important),
        () => undefined,
      );
    load();
    const t = setInterval(load, 5 * 60_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [on]);
  return n;
}
