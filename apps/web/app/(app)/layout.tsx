'use client';

import { Bell, Home, Settings, Shield } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { CommandBar } from '@/components/command-bar';
import { NotificationCenter } from '@/components/notification-center';
import { Avatar } from '@/components/ui/bits';
import { Orb } from '@/components/ui/orb';
import { cn } from '@/lib/cn';
import { NotificationsProvider, useNotifications } from '@/lib/notifications';
import { useSession } from '@/lib/session';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);
  if (status !== 'signedIn') return <Splash />;
  return (
    <NotificationsProvider>
      <Shell>{children}</Shell>
    </NotificationsProvider>
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
  const { me } = useSession();
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
    { href: '/settings', label: 'Settings', icon: Settings },
    ...(me?.role === 'owner' ? [{ href: '/admin', label: 'People', icon: Shield }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1440px] gap-4 p-3 pb-28 sm:p-5 lg:pb-5">
      <aside className="glass-pane sticky top-5 hidden h-[calc(100dvh-40px)] w-60 shrink-0 flex-col p-3 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2 pt-2">
          <span
            aria-hidden
            className="h-7 w-7 rounded-full shadow-[0_0_24px_color-mix(in_srgb,var(--orv-accent-from)_60%,transparent)] [background:radial-gradient(circle_at_35%_30%,white,var(--orv-accent-from)_45%,var(--orv-accent-to))]"
          />
          <span className="text-[17px] font-semibold tracking-[0.14em]">ORVYN</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {nav.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={pathname === i.href ? 'page' : undefined}
              className={cn(
                'flex h-11 items-center gap-3 rounded-orv-md px-3 text-[14px] font-medium transition-colors',
                pathname === i.href
                  ? 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-text'
                  : 'text-orv-muted hover:bg-orv-track hover:text-orv-text',
              )}
            >
              <i.icon size={18} aria-hidden className={pathname === i.href ? 'text-orv-accent' : ''} />
              {i.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => setCommand(true)}
          className="mt-4 flex h-10 items-center gap-2 rounded-orv-md border border-orv-edge px-3 text-[13px] text-orv-muted hover:text-orv-text"
        >
          Ask or do anything
          <kbd className="ml-auto rounded border border-orv-edge px-1 font-mono text-[10px]">Ctrl K</kbd>
        </button>
        <div className="mt-auto flex items-center gap-3 rounded-orv-md p-2">
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

      {/* phone dock: one-hand reach, the Orb in the middle */}
      <nav
        aria-label="Main"
        className="glass-float fixed inset-x-3 bottom-3 z-40 grid h-16 grid-cols-3 items-center lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <DockLink href="/" label="Home" active={pathname === '/'} icon={<Home size={20} />} />
        <span />
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
