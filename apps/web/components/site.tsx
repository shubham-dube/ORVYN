'use client';

import { ArrowRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Logo, Wordmark } from '@/components/logo';
import { cn } from '@/lib/cn';
import { CONTACT } from '@/lib/downloads';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/security', label: 'Security' },
  { href: '/download', label: 'Download' },
  { href: '/faq', label: 'FAQ' },
];

/** The public site's frame: a floating glass header and a quiet footer (spec 0007 C4). */
export function SiteFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  const cta =
    status === 'signedIn' ? (
      <SiteButton href="/" primary>
        Open ORVYN <ArrowRight size={15} aria-hidden />
      </SiteButton>
    ) : (
      <SiteButton href="/sign-in" primary>
        Sign in <ArrowRight size={15} aria-hidden />
      </SiteButton>
    );
  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className={cn('sticky top-0 z-40 transition-all duration-300', scrolled ? 'py-2' : 'py-4')}>
        <div
          className={cn(
            'mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 transition-all duration-300 sm:px-5',
            scrolled && 'glass-float mx-3 !rounded-full sm:mx-auto',
          )}
        >
          <Link href="/welcome" aria-label="ORVYN home" className="shrink-0">
            <Wordmark size={30} />
          </Link>
          <nav aria-label="Site" className="ml-4 hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[14px] transition-colors',
                  path === n.href ? 'bg-orv-track text-orv-text' : 'text-orv-muted hover:text-orv-text',
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto hidden md:block">{cta}</div>
          <button
            type="button"
            className="ml-auto grid h-10 w-10 place-items-center rounded-full md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open ? (
          <nav aria-label="Site menu" className="glass-halo mx-3 mt-2 flex flex-col gap-1 p-3 md:hidden">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-orv-md px-3 py-2.5 text-[16px] hover:bg-orv-track"
              >
                {n.label}
              </Link>
            ))}
            <div className="mt-2">{cta}</div>
          </nav>
        ) : null}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-24 border-t border-orv-hairline">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <Wordmark size={28} />
            <p className="max-w-xs text-small text-orv-muted">
              Your private operating system for everyday life. Made in India, for people who want one calm
              place for everything.
            </p>
          </div>
          <FooterCol title="Product" links={[...NAV.slice(0, 3), { href: '/sign-in', label: 'Sign in' }]} />
          <FooterCol
            title="Help"
            links={[
              { href: '/faq', label: 'FAQ' },
              { href: '/download#install', label: 'Installing' },
              { href: CONTACT, label: 'Contact' },
            ]}
          />
          <FooterCol
            title="Legal"
            links={[
              { href: '/privacy', label: 'Privacy' },
              { href: '/terms', label: 'Terms' },
            ]}
          />
        </div>
        <p className="pb-8 text-center text-[12px] text-orv-faint">© {new Date().getFullYear()} ORVYN</p>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-orv-muted">{title}</p>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-[14px] text-orv-text/80 hover:text-orv-accent">
          {l.label}
        </Link>
      ))}
    </div>
  );
}

export function SiteButton({
  href,
  children,
  primary,
  download,
  external,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
  download?: boolean;
  external?: boolean;
}) {
  const cls = cn(
    'inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-all',
    primary
      ? 'text-white shadow-[0_10px_30px_-8px_var(--orv-accent-from)] [background:var(--orv-accent-grad)] hover:-translate-y-0.5 hover:shadow-[0_14px_36px_-8px_var(--orv-accent-from)]'
      : 'glass-pane text-orv-text hover:-translate-y-0.5',
  );
  return external || download ? (
    <a
      href={href}
      className={cls}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      download={download}
    >
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** A section heading in the site's voice: eyebrow, title, line. */
export function SiteHeading({
  eyebrow,
  title,
  children,
  center,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-3', center && 'items-center text-center')}>
      {eyebrow ? (
        <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-orv-accent">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="max-w-3xl text-balance text-[32px] font-semibold leading-tight tracking-tight sm:text-[40px]">
        {title}
      </h2>
      {children ? (
        <p className="max-w-2xl text-pretty text-[17px] leading-relaxed text-orv-muted">{children}</p>
      ) : null}
    </div>
  );
}

/** A simple page for the text pages (privacy, terms, security): a title and readable prose. */
export function SitePage({ title, line, children }: { title: string; line?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-5 pt-10">
      <Logo size={44} className="mb-5" />
      <h1 className="text-balance text-[38px] font-semibold leading-tight tracking-tight">{title}</h1>
      {line ? <p className="mt-3 text-[17px] text-orv-muted">{line}</p> : null}
      <div className="site-prose mt-10">{children}</div>
    </article>
  );
}
