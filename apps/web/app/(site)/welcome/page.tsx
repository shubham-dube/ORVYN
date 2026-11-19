import {
  BookOpen,
  Brain,
  CalendarCheck,
  Chrome,
  Inbox,
  Lock,
  MessageSquareReply,
  Mic,
  Monitor,
  Plug,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { Metadata } from 'next';
import { Logo } from '@/components/logo';
import { SiteButton, SiteHeading } from '@/components/site';

export const metadata: Metadata = {
  title: 'ORVYN — your private operating system for everyday life',
  description:
    'Tasks, calendar, money, documents and secrets in one calm, private place — on Android, the web, Windows and Chrome.',
};

const MODULES = [
  {
    icon: CalendarCheck,
    name: 'Today',
    line: 'Tasks and calendar on one river of time. Type “kal shaam 6 baje call mom” and it’s understood.',
  },
  {
    icon: Inbox,
    name: 'Drop',
    line: 'Photograph, say or forward anything. It files itself — you just confirm.',
  },
  {
    icon: Wallet,
    name: 'Money',
    line: 'Spending captured from bank and UPI alerts. Reply “food” to a notification and it’s filed.',
  },
  {
    icon: BookOpen,
    name: 'Library',
    line: 'Documents that read themselves: titles, tags, expiry reminders.',
  },
  {
    icon: Lock,
    name: 'Vault',
    line: 'Passwords and IDs only your devices can open. Zero-knowledge, for real.',
  },
  {
    icon: Plug,
    name: 'Connections',
    line: 'Several Google accounts, Meet invites, Gmail and ClickUp in one place.',
  },
];

const SMART = [
  {
    icon: MessageSquareReply,
    title: 'Answer from the notification',
    line: '“₹240 at Swiggy — what was it?” Reply “food”, “split 3” or “not mine”. Say “always food” and it never asks again.',
  },
  {
    icon: Brain,
    title: 'Rules first, AI when it matters',
    line: 'ORVYN’s own parsers understand most of what you type for free. AI only steps in when it’s needed — and never acts on its own.',
  },
  {
    icon: Mic,
    title: 'Say it once',
    line: 'Voice notes are written down word for word — no repeats — and you can keep the recording too.',
  },
  {
    icon: Sparkles,
    title: 'A home that tells you what matters',
    line: 'Your day at a glance, what needs you, money this month, papers that expire soon.',
  },
];

const DEVICES = [
  {
    icon: Smartphone,
    name: 'Android',
    line: 'The full app, alarms that ring, payment capture, a home-screen widget.',
  },
  {
    icon: Monitor,
    name: 'Windows',
    line: 'A tray app: quick add with a hotkey, notifications even when the browser is closed.',
  },
  {
    icon: Chrome,
    name: 'Chrome',
    line: 'Your tasks and money in the toolbar; save any page or selection to Drop.',
  },
  {
    icon: Sparkles,
    name: 'Web',
    line: 'Everything, in any browser — installable as an app on iPhone and Mac.',
  },
];

export default function Welcome() {
  return (
    <div className="flex flex-col gap-32 px-4 sm:px-5">
      {/* hero */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-12 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div className="flex flex-col gap-6">
          <span className="glass-pane inline-flex w-fit items-center gap-2 !rounded-full px-3 py-1 text-[13px] text-orv-muted">
            <span className="h-2 w-2 rounded-full bg-orv-success" aria-hidden /> Invite-only, and private by
            design
          </span>
          <h1 className="text-balance text-[44px] font-semibold leading-[1.04] tracking-tight sm:text-[64px]">
            Your whole life,
            <br />
            <span className="bg-clip-text text-transparent [background-image:var(--orv-accent-grad)]">
              in one calm orbit.
            </span>
          </h1>
          <p className="max-w-xl text-pretty text-[18px] leading-relaxed text-orv-muted">
            Tasks, calendar, money, documents and secrets — understood the way you say them, on every device
            you use. ORVYN proposes; you decide. Nothing about you is ever someone else’s.
          </p>
          <div className="flex flex-wrap gap-3">
            <SiteButton href="/sign-in" primary>
              Open ORVYN
            </SiteButton>
            <SiteButton href="/download">Get the apps</SiteButton>
          </div>
          <p className="text-[13px] text-orv-faint">Android · Windows · Chrome · any browser</p>
        </div>
        <HeroPreview />
      </section>

      {/* modules */}
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <SiteHeading eyebrow="Everything in one place" title="Six apps you’d juggle, as one that gets you.">
          Each part works on its own and together: an expense in Drop becomes a Money entry, a bill’s due date
          becomes a reminder, a meeting gets a Meet link.
        </SiteHeading>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <li
              key={m.name}
              className="glass-pane group flex flex-col gap-3 p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <span className="grid h-11 w-11 place-items-center rounded-[14px] text-white shadow-[0_8px_20px_-8px_var(--orv-accent-from)] [background:var(--orv-accent-grad)]">
                <m.icon size={20} aria-hidden />
              </span>
              <h3 className="text-[19px] font-semibold">{m.name}</h3>
              <p className="text-[15px] leading-relaxed text-orv-muted">{m.line}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* smart */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SiteHeading eyebrow="Smart, not noisy" title="It does the boring part. You keep the say.">
          ORVYN learns from your answers, not from tracking you. Every suggestion has a reason, and money,
          messages and deletions always wait for your tap.
        </SiteHeading>
        <ul className="grid gap-4 sm:grid-cols-2">
          {SMART.map((s) => (
            <li key={s.title} className="glass-pane flex flex-col gap-2 p-5">
              <s.icon size={20} className="text-orv-accent" aria-hidden />
              <h3 className="text-[16px] font-semibold">{s.title}</h3>
              <p className="text-[14px] leading-relaxed text-orv-muted">{s.line}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* privacy */}
      <section className="mx-auto w-full max-w-6xl">
        <div className="glass-halo edge-light relative grid gap-10 overflow-hidden p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-30 blur-3xl [background:var(--orv-accent-grad)]"
          />
          <SiteHeading eyebrow="Private by design" title="Your data is yours. Not ours, not an ad network’s.">
            Your Vault is encrypted on your device with a key that never leaves it — we couldn’t read it if we
            wanted to. Everything else is yours alone, encrypted at rest, never sold, never used to train
            anyone’s AI.
          </SiteHeading>
          <ul className="relative flex flex-col gap-3 text-[15px]">
            {[
              'Zero-knowledge Vault (Argon2id + XChaCha20-Poly1305)',
              'Passkeys — no passwords to steal',
              'Every query scoped to you; sharing only when you invite',
              'AI sees only what a task needs, and never the Vault',
              'Files encrypted at rest; keys sealed on the server',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-orv-success" aria-hidden />
                {t}
              </li>
            ))}
            <li className="pt-2">
              <SiteButton href="/security">How it’s protected</SiteButton>
            </li>
          </ul>
        </div>
      </section>

      {/* devices */}
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <SiteHeading eyebrow="Everywhere you are" title="Open it anywhere. It’s already up to date." center>
          Change something on your phone and it’s on your laptop before you look up. Works offline and catches
          up when you’re back.
        </SiteHeading>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEVICES.map((d) => (
            <li key={d.name} className="glass-pane flex flex-col gap-2 p-5">
              <d.icon size={22} className="text-orv-accent" aria-hidden />
              <h3 className="text-[16px] font-semibold">{d.name}</h3>
              <p className="text-[14px] leading-relaxed text-orv-muted">{d.line}</p>
            </li>
          ))}
        </ul>
        <div className="flex justify-center">
          <SiteButton href="/download" primary>
            Download ORVYN
          </SiteButton>
        </div>
      </section>

      {/* final */}
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        <Logo size={72} />
        <h2 className="text-balance text-[36px] font-semibold leading-tight tracking-tight sm:text-[48px]">
          One calm place for everything.
        </h2>
        <p className="text-[17px] text-orv-muted">
          ORVYN is invite-only while it grows. Got an invite? You’re one email away.
        </p>
        <SiteButton href="/sign-in" primary>
          Open ORVYN
        </SiteButton>
      </section>
    </div>
  );
}

/** A still of the app, built from the same parts (so it always matches): today's ring, a task list, a payment ask. */
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="absolute inset-8 -z-10 rounded-full opacity-40 blur-3xl [background:var(--orv-accent-grad)]" />
      <div className="glass-halo edge-light flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <svg width="74" height="74" viewBox="0 0 74 74" className="shrink-0">
            <circle cx="37" cy="37" r="31" fill="none" stroke="var(--orv-track)" strokeWidth="8" />
            <circle
              cx="37"
              cy="37"
              r="31"
              fill="none"
              stroke="url(#heroring)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 31 * 0.62} 999`}
              transform="rotate(-90 37 37)"
            />
            <defs>
              <linearGradient id="heroring" x1="0" x2="1">
                <stop offset="0" stopColor="var(--orv-accent-from)" />
                <stop offset="1" stopColor="var(--orv-accent-to)" />
              </linearGradient>
            </defs>
            <text x="37" y="42" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">
              5/8
            </text>
          </svg>
          <div>
            <p className="text-[13px] text-orv-muted">Thursday, 19 November</p>
            <p className="text-[22px] font-semibold">Good morning</p>
            <p className="text-[13px] text-orv-muted">Next: Design review · 11:00 · Meet</p>
          </div>
        </div>
        <ul className="flex flex-col gap-1 rounded-orv-lg bg-orv-track p-2">
          {[
            ['Call the bank about the card', '3:00 PM', false],
            ['Renew passport', 'Fri', false],
            ['Pay electricity bill', 'done', true],
          ].map(([t, w, done]) => (
            <li key={t as string} className="flex items-center gap-3 rounded-orv-md px-2 py-2">
              <span
                className={
                  done
                    ? 'grid h-5 w-5 place-items-center rounded-full text-[11px] text-white [background:var(--orv-accent-grad)]'
                    : 'h-5 w-5 rounded-full border-2 border-orv-edge'
                }
              >
                {done ? '✓' : ''}
              </span>
              <span
                className={done ? 'flex-1 text-[14px] text-orv-faint line-through' : 'flex-1 text-[14px]'}
              >
                {t}
              </span>
              <span className="text-[12px] text-orv-muted">{w}</span>
            </li>
          ))}
        </ul>
        <div className="glass-float flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-[12px] text-orv-muted">
            <Logo size={16} glyph /> ORVYN · now
          </div>
          <p className="text-[15px] font-semibold">₹240 at Swiggy</p>
          <p className="text-[13px] text-orv-muted">What was it? Tap “Food & dining” or reply.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="rounded-full px-3 py-1 text-[12px] font-semibold text-white [background:var(--orv-accent-grad)]">
              Food &amp; dining
            </span>
            <span className="rounded-full bg-orv-track px-3 py-1 text-[12px]">Reply</span>
            <span className="rounded-full bg-orv-track px-3 py-1 text-[12px]">Not mine</span>
          </div>
        </div>
      </div>
    </div>
  );
}
