'use client';

import {
  BRIEF_SECTIONS,
  type BriefAgenda,
  type BriefFocus,
  type BriefPlace,
  type BriefSection,
  type BriefSettings,
  type BriefView,
  type BriefWeather,
  formatMoney,
  NUDGE_KINDS,
} from '@orvyn/contracts';
import {
  ArrowDownRight,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Flame,
  GitPullRequest,
  Lightbulb,
  LineChart,
  Mail,
  MapPin,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Target,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Badge, Glass, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

const SECTION_NAME: Record<(typeof BRIEF_SECTIONS)[number], string> = {
  weather: 'Weather',
  focus: 'Your three for today',
  agenda: 'Your day',
  ipo: 'IPOs',
  money: 'Money',
  markets: 'Markets',
  work: 'From your tools',
  mail: 'Mail',
  drop: 'Drop',
  library: 'Running out',
  yesterday: 'Yesterday',
};
const NUDGE_NAME: Record<(typeof NUDGE_KINDS)[number], { name: string; line: string }> = {
  slipped: { name: 'Things that slipped', line: '3 or more overdue tasks, with “Move to today”' },
  budget: { name: 'Budget drifting', line: 'A budget at 80% early in the month, or used up' },
  payments: { name: 'Payments waiting', line: '5 or more captured payments not looked at' },
  drop: { name: 'Drop piling up', line: '3 or more things waiting for a day' },
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const span = (a: string, b: string) => {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
};
const day = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export function SkyIcon({
  code,
  size = 18,
  className,
}: {
  code: number | null;
  size?: number;
  className?: string;
}) {
  const p = { size, className, 'aria-hidden': true };
  if (code === null) return <CloudSun {...p} />;
  if (code === 0) return <Sun {...p} />;
  if (code <= 2) return <CloudSun {...p} />;
  if (code === 3) return <Cloud {...p} />;
  if (code <= 48) return <CloudFog {...p} />;
  if (code <= 57) return <CloudDrizzle {...p} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain {...p} />;
  if (code <= 77 || code <= 86) return <CloudSnow {...p} />;
  return <CloudLightning {...p} />;
}

/** Today's Brief, reloadable; null while loading. */
export function useBrief() {
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [settings, setSettings] = useState<BriefSettings | null>(null);
  const load = useCallback(async (refresh = false) => {
    const [b, s] = await Promise.all([
      api<BriefView>(refresh ? '/brief/today/refresh' : '/brief/today', refresh ? { method: 'POST' } : {}),
      api<BriefSettings>('/brief/settings'),
    ]);
    setBrief(b);
    setSettings(s);
  }, []);
  useEffect(() => void load().catch(() => undefined), [load]);
  return { brief, settings, setSettings, setBrief, reload: load };
}

function Card({
  icon,
  title,
  children,
  href,
  className,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  href?: string;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <Glass level="pane" as="section" className={cn('flex flex-col gap-3 p-5', className)} aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent">
          {icon}
        </span>
        <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
        {action}
        {href ? (
          <Link href={href} className="text-[12px] text-orv-accent hover:underline">
            Open
          </Link>
        ) : null}
      </div>
      {children}
    </Glass>
  );
}

function Row({ left, right, muted }: { left: ReactNode; right?: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <span className={cn('min-w-0 flex-1 truncate text-[14px]', muted && 'text-orv-muted')}>{left}</span>
      {right !== undefined ? (
        <span className="shrink-0 text-[13px] tabular-nums text-orv-muted">{right}</span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the sections

function Focus({ s, onPlanned }: { s: BriefFocus; onPlanned(b: BriefView): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card icon={<Target size={15} />} title={SECTION_NAME.focus} href="/today">
      {s.items.length ? (
        <ol className="flex flex-col gap-2">
          {s.items.map((t, n) => (
            <li key={t.id} className="flex items-center gap-3 rounded-[14px] bg-orv-track/60 px-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[image:var(--orv-accent-grad)] text-[13px] font-semibold text-white">
                {n + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{t.title}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-orv-muted">
                  {t.overdue ? <Badge tone="warning">overdue</Badge> : null}
                  {t.priority >= 3 ? <Badge tone="accent">high</Badge> : null}
                  {t.slot ? (
                    <span className="tabular-nums">
                      {time(t.slot.start)}–{time(t.slot.end)}
                    </span>
                  ) : (
                    <span>no free {t.minutes}-minute stretch left today</span>
                  )}
                </span>
              </span>
              {t.planned ? (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-orv-success">
                  <Check size={13} /> Planned
                </span>
              ) : t.slot ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy === t.id}
                  onClick={async () => {
                    setBusy(t.id);
                    try {
                      onPlanned(
                        await api<BriefView>('/brief/plan', {
                          method: 'POST',
                          body: { taskId: t.id, start: t.slot!.start, minutes: t.minutes },
                        }),
                      );
                      toast({ title: `${t.title} — planned for ${time(t.slot!.start)}`, tone: 'success' });
                    } catch (e) {
                      toast({
                        title: e instanceof ApiError ? e.message : 'Couldn’t plan it',
                        tone: 'danger',
                      });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <CalendarClock size={14} /> Plan it
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13.5px] text-orv-muted">
          Nothing pressing. Pick something you’ve been putting off.
        </p>
      )}
      {s.free.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-orv-muted">Free:</span>
          {s.free.map((f) => (
            <span
              key={f.start}
              className="rounded-full bg-[color-mix(in_srgb,var(--orv-success)_12%,transparent)] px-2 py-0.5 tabular-nums text-orv-success"
            >
              {time(f.start)}–{time(f.end)}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** The day as a line: meetings in order, the free stretches between them marked. */
function Agenda({ s }: { s: BriefAgenda }) {
  const timed = s.events.filter((e) => !e.allDay && e.at);
  const allDay = s.events.filter((e) => e.allDay || !e.at);
  return (
    <Card icon={<CalendarDays size={15} />} title={SECTION_NAME.agenda} href="/today">
      {allDay.length ? (
        <div className="flex flex-wrap gap-1.5">
          {allDay.map((e, n) => (
            <span key={n} className="rounded-full bg-orv-track px-2.5 py-0.5 text-[12px]">
              {e.title}
            </span>
          ))}
        </div>
      ) : null}
      {timed.length ? (
        <ol className="relative flex flex-col gap-0.5 pl-4">
          <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-orv-edge" />
          {timed.map((e, n) => {
            const prev = timed[n - 1];
            const gap = prev?.until && e.at && Date.parse(e.at) - Date.parse(prev.until) >= 45 * 60_000;
            return (
              <li key={n} className="flex flex-col">
                {gap ? (
                  <span className="my-1 -ml-4 pl-4 text-[11.5px] italic text-orv-success">
                    free {span(prev.until!, e.at!)}
                  </span>
                ) : null}
                <span className="relative flex items-baseline gap-3 py-1">
                  <span
                    aria-hidden
                    className="absolute -left-[15px] top-[9px] h-2.5 w-2.5 rounded-full border-2 border-orv-accent bg-[var(--orv-base)]"
                  />
                  <span className="w-[4.5rem] shrink-0 text-[12.5px] tabular-nums text-orv-muted">
                    {time(e.at!)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{e.title}</span>
                    {e.location ? (
                      <span className="block truncate text-[12px] text-orv-muted">{e.location}</span>
                    ) : null}
                  </span>
                  {e.until ? (
                    <span className="text-[12px] tabular-nums text-orv-faint">{span(e.at!, e.until)}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[13.5px] text-orv-muted">No meetings. The day is yours.</p>
      )}
      <p className="border-t border-orv-edge pt-2 text-[12px] text-orv-muted">
        {s.dueToday} due today{s.overdue ? ` · ${s.overdue} overdue` : ''}
      </p>
    </Card>
  );
}

const IPO_WHEN = {
  closes: 'Last day',
  opens: 'Opens today',
  open: 'Open',
  allotment: 'Allotment today',
  listing: 'Lists today',
  upcoming: 'Soon',
};

export function BriefSections({
  sections,
  onChange,
}: {
  sections: BriefSection[];
  onChange?(b: BriefView): void;
}) {
  const toast = useToast();
  if (!sections.length) return <p className="text-small text-orv-muted">Nothing to report. A clear day.</p>;
  const main: BriefSection[] = sections.filter(
    (s) => s.kind === 'focus' || s.kind === 'agenda' || s.kind === 'ipo',
  );
  const side = sections.filter((s) => !main.includes(s) && s.kind !== 'weather');
  const one = (s: BriefSection) => {
    switch (s.kind) {
      case 'focus':
        return <Focus key="focus" s={s} onPlanned={(b) => onChange?.(b)} />;
      case 'agenda':
        return <Agenda key="agenda" s={s} />;
      case 'ipo':
        return (
          <Card key="ipo" icon={<Rocket size={15} />} title={SECTION_NAME.ipo} href="/ipo">
            {s.items.map((i) => (
              <Link
                key={i.id}
                href={`/ipo/${i.id}`}
                className="flex items-center gap-3 rounded-[14px] bg-orv-track/60 px-3 py-2.5 hover:bg-orv-track"
              >
                {i.logo ? (
                  <img
                    src={i.logo}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-[10px] border border-orv-edge bg-white object-contain p-0.5"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[image:var(--orv-accent-grad)] font-semibold text-white">
                    {i.name[0]}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{i.name}</span>
                  <span className="block truncate text-[12px] text-orv-muted tabular-nums">
                    {i.gmpPct !== null ? `GMP ${i.gmpPct.toFixed(0)}%` : 'GMP —'}
                    {i.lotAmount ? ` · lot ${formatMoney(Math.round(i.lotAmount * 100))}` : ''}
                    {i.gainPerLot !== null
                      ? ` · ${i.gainPerLot >= 0 ? '+' : '−'}₹${Math.abs(i.gainPerLot).toLocaleString('en-IN')}/lot`
                      : ''}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge
                    tone={
                      i.today === 'closes'
                        ? 'danger'
                        : i.today === 'listing' || i.today === 'opens'
                          ? 'accent'
                          : 'neutral'
                    }
                  >
                    {IPO_WHEN[i.today]}
                  </Badge>
                  {i.decision ? (
                    <span className="text-[11.5px] text-orv-accent">
                      {{
                        applying: 'you’ll apply',
                        applied: 'applied',
                        allotted: 'allotted',
                        not_allotted: 'not allotted',
                        skipped: 'skipped',
                      }[i.decision] ?? i.decision}
                    </span>
                  ) : i.today === 'closes' || i.today === 'opens' || i.today === 'open' ? (
                    <button
                      type="button"
                      className="text-[11.5px] font-medium text-orv-accent hover:underline"
                      onClick={async (e) => {
                        e.preventDefault();
                        await api(`/ipo/issues/${i.id}/decision`, {
                          method: 'PUT',
                          body: { decision: 'applying' },
                        });
                        toast({ title: 'Added to Today', body: `Apply for ${i.name}`, tone: 'success' });
                      }}
                    >
                      I’ll apply
                    </button>
                  ) : null}
                </span>
              </Link>
            ))}
          </Card>
        );
      case 'money':
        return (
          <Card key="money" icon={<Wallet size={15} />} title={SECTION_NAME.money} href="/money">
            {s.inHandMinor !== null && s.inHandMinor !== undefined ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-orv-muted">In your hand</p>
                <p
                  className={cn(
                    'text-[24px] font-semibold tabular-nums',
                    s.inHandMinor < 0 && 'text-orv-danger',
                  )}
                >
                  {formatMoney(s.inHandMinor)}
                </p>
              </div>
            ) : null}
            <Row left="Yesterday" right={formatMoney(s.yesterdayMinor)} />
            <Row left="This month" right={formatMoney(s.monthMinor)} />
            {s.dues?.length ? (
              <div className="border-t border-orv-edge pt-2">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-orv-muted">Due soon</p>
                {s.dues.map((d, n) => (
                  <Row
                    key={n}
                    left={
                      <span className="inline-flex items-center gap-1.5">
                        {d.kind === 'pay' ? (
                          <ArrowUpRight size={13} className="text-orv-danger" />
                        ) : (
                          <ArrowDownRight size={13} className="text-orv-success" />
                        )}
                        {d.title}
                      </span>
                    }
                    right={`${formatMoney(d.amountMinor)} · ${day(d.on)}`}
                  />
                ))}
              </div>
            ) : null}
            {s.budgets.map((b) => (
              <Row
                key={b.name}
                left={`${b.name} budget`}
                right={
                  <span className={b.spentMinor >= b.amountMinor ? 'text-orv-danger' : 'text-orv-warning'}>
                    {Math.round((b.spentMinor / b.amountMinor) * 100)}% of {formatMoney(b.amountMinor)}
                  </span>
                }
              />
            ))}
            {s.toReview ? <Row left={`${s.toReview} payments to look at`} muted /> : null}
          </Card>
        );
      case 'markets':
        return (
          <Card key="markets" icon={<LineChart size={15} />} title={SECTION_NAME.markets}>
            <div className="grid grid-cols-2 gap-2">
              {s.items.map((m) => (
                <div key={m.name} className="rounded-[14px] bg-orv-track/60 px-3 py-2">
                  <p className="text-[12px] text-orv-muted">{m.name}</p>
                  <p className="text-[16px] font-semibold tabular-nums">{m.last.toLocaleString('en-IN')}</p>
                  <p
                    className={cn(
                      'text-[12.5px] font-medium tabular-nums',
                      m.changePct >= 0 ? 'text-orv-success' : 'text-orv-danger',
                    )}
                  >
                    {m.changePct >= 0 ? '▲' : '▼'} {Math.abs(m.changePct).toFixed(2)}%
                  </p>
                </div>
              ))}
            </div>
            {s.at ? (
              <p className="text-[11.5px] text-orv-faint">
                As of{' '}
                {new Date(s.at).toLocaleString(undefined, {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            ) : null}
          </Card>
        );
      case 'drop':
        return (
          <Card key="drop" icon={<ArrowDownToLine size={15} />} title={SECTION_NAME.drop} href="/drop">
            <Row left={`${s.waiting} ${s.waiting === 1 ? 'thing waits' : 'things wait'} for a decision`} />
          </Card>
        );
      case 'library':
        return (
          <Card key="library" icon={<BookOpen size={15} />} title={SECTION_NAME.library} href="/library">
            {s.expiring.map((d) => (
              <Row key={d.id} left={d.title} right={d.days === 0 ? 'today' : `in ${d.days} d`} />
            ))}
          </Card>
        );
      case 'work':
        return (
          <Card key="work" icon={<GitPullRequest size={15} />} title={SECTION_NAME.work} href="/today">
            {s.reviews ? <Row left="Reviews waiting for you" right={s.reviews} /> : null}
            {s.issues ? <Row left="GitHub issues assigned" right={s.issues} /> : null}
            {s.clickup ? (
              <Row
                left="ClickUp tasks"
                right={s.clickupDueToday ? `${s.clickup} · ${s.clickupDueToday} due` : s.clickup}
              />
            ) : null}
          </Card>
        );
      case 'mail':
        return (
          <Card key="mail" icon={<Mail size={15} />} title={SECTION_NAME.mail} href="/">
            {s.boxes.map((b) => (
              <Row key={b.account} left={b.account} right={`${b.unread} unread`} />
            ))}
          </Card>
        );
      case 'yesterday':
        return (
          <Card key="yesterday" icon={<Flame size={15} />} title={SECTION_NAME.yesterday}>
            <p className="text-[14px]">
              {s.done ? `${s.done} ${s.done === 1 ? 'task' : 'tasks'} done` : 'A quiet day'}
              {s.spentMinor ? ` · ${formatMoney(s.spentMinor)} spent` : ''}
            </p>
            {s.streak >= 2 ? (
              <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-orv-warning">
                <Flame size={14} /> {s.streak} days in a row with something done
              </p>
            ) : null}
          </Card>
        );
      default:
        return null;
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">{main.map(one)}</div>
      <div className="flex flex-col gap-4">{side.map(one)}</div>
    </div>
  );
}

/** The top of the Brief: the date, the greeting, the weather, and what the AI made of the day. */
function Hero({
  b,
  onRefresh,
  onSettings,
  busy,
}: {
  b: BriefView;
  onRefresh(): void;
  onSettings(): void;
  busy: boolean;
}) {
  const w = b.sections.find((s): s is BriefWeather => s.kind === 'weather');
  return (
    <Glass level="float" className="relative overflow-hidden p-6 sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[image:var(--orv-accent-grad)] opacity-25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-orv-warning opacity-10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-orv-muted">
            {new Date(`${b.day}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight sm:text-[34px]">
            {b.greeting ?? 'Your Brief'}
          </h1>
        </div>
        {w ? (
          <div className="flex items-center gap-3 rounded-[18px] bg-orv-track/70 px-4 py-2.5">
            <SkyIcon code={w.code} size={30} className="text-orv-warning" />
            <div>
              <p className="text-[22px] font-semibold leading-none tabular-nums">{w.now ?? w.high}°</p>
              <p className="mt-1 text-[12px] text-orv-muted">
                {w.sky} · {w.high}°/{w.low}°{w.rain !== null && w.rain >= 20 ? ` · ${w.rain}% rain` : ''}
              </p>
              <p className="flex items-center gap-2 text-[11.5px] text-orv-faint">
                <MapPin size={11} /> {w.place}
                {w.sunset ? (
                  <>
                    <Sunset size={11} /> {w.sunset}
                  </>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <div className="relative mt-4 max-w-3xl">
        {b.story ? (
          <>
            <p className="text-[17px] leading-relaxed">{b.story}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-orv-faint">
              <Sparkles size={11} /> Written by AI from your day
            </p>
          </>
        ) : (
          <>
            <p className="text-[19px] font-semibold">{b.headline}</p>
            <p className="mt-1 text-[14px] text-orv-muted">{b.line}</p>
          </>
        )}
        {b.tip || w?.advice ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {b.tip ? (
              <p className="inline-flex items-start gap-2 rounded-[14px] bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)] px-3 py-2 text-[13.5px]">
                <Lightbulb size={15} className="mt-0.5 shrink-0 text-orv-accent" /> {b.tip}
              </p>
            ) : null}
            {w?.advice ? (
              <p className="inline-flex items-start gap-2 text-[13px] text-orv-muted">
                <CloudRain size={14} className="mt-0.5 shrink-0" /> {w.advice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative mt-4 flex gap-2">
        <Button variant="ghost" size="sm" loading={busy} onClick={onRefresh}>
          <RefreshCw size={14} /> Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={onSettings}>
          <Settings2 size={14} /> Settings
        </Button>
      </div>
    </Glass>
  );
}

/** A place for the weather, found by name (Open-Meteo); nothing about this device's location is sent. */
function PlacePicker({
  value,
  onChange,
}: {
  value: BriefPlace | null;
  onChange(p: BriefPlace | null): void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<BriefPlace[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(
      () =>
        void api<BriefPlace[]>(`/brief/places?q=${encodeURIComponent(q.trim())}`)
          .then(setFound)
          .catch(() => setFound([])),
      300,
    );
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-2 text-[14px]">
          <MapPin size={14} className="text-orv-accent" /> <span className="flex-1">{value.name}</span>
          <button
            type="button"
            className="text-[12px] text-orv-muted underline"
            onClick={() => onChange(null)}
          >
            Remove
          </button>
        </div>
      ) : null}
      <input
        aria-label="Find a place"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={value ? 'Change the place…' : 'Your city, e.g. Bengaluru'}
        className="h-10 rounded-orv-md field-ring px-3 text-[14px] outline-none"
      />
      {found.length ? (
        <ul className="flex flex-col rounded-orv-md border border-orv-edge">
          {found.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setQ('');
                  setFound([]);
                }}
                className="w-full px-3 py-2 text-left text-[13.5px] hover:bg-orv-track"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What the Brief carries and when it comes; saved together. */
export function BriefSettingsSheet({
  open,
  value,
  onClose,
  onSaved,
}: {
  open: boolean;
  value: BriefSettings;
  onClose(): void;
  onSaved(s: BriefSettings): void;
}) {
  const toast = useToast();
  const [s, setS] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(value), [value, open]);
  const toggle = <T,>(xs: T[], x: T, on: boolean) =>
    on ? [...new Set([...xs, x])] : xs.filter((y) => y !== x);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<BriefSettings>('/brief/settings', { method: 'PUT', body: s });
      onSaved(r);
      toast({ title: r.enabled ? `Your Brief comes at ${r.at}` : 'Brief turned off', tone: 'success' });
      onClose();
    } catch {
      toast({ title: 'Couldn’t save', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Brief settings"
      subtitle="Your morning, the way you want it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Sunrise size={16} className="text-orv-accent" />
            <div className="flex-1">
              <p className="text-[14px] font-semibold">Morning Brief</p>
              <p className="text-[12px] text-orv-muted">
                One notification at this time. Replaces Today’s morning summary.
              </p>
            </div>
            <input
              type="time"
              aria-label="Brief time"
              value={s.at}
              onChange={(e) => setS({ ...s, at: e.target.value || '07:30' })}
              className="h-9 rounded-orv-md field-ring px-2 text-[14px]"
            />
            <Switch label="Morning Brief" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Sparkles size={16} className="text-orv-accent" />
            <div className="flex-1">
              <p className="text-[14px] font-semibold">Write it with AI</p>
              <p className="text-[12px] text-orv-muted">
                A short opening and one tip, from the Brief’s facts. Those facts go to the AI provider; it
                only writes, it never changes anything.
              </p>
            </div>
            <Switch label="Write it with AI" checked={s.ai} onChange={(v) => setS({ ...s, ai: v })} />
          </div>
        </div>
        <div>
          <Label className="mb-2 block">Weather for</Label>
          <PlacePicker value={s.place} onChange={(p) => setS({ ...s, place: p })} />
        </div>
        <div>
          <Label className="mb-2 block">What it carries</Label>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {BRIEF_SECTIONS.map((k) => (
              <div key={k} className="flex items-center gap-3">
                <span className="flex-1 text-[14px]">{SECTION_NAME[k]}</span>
                <Switch
                  label={SECTION_NAME[k]}
                  checked={s.sections.includes(k)}
                  onChange={(v) => setS({ ...s, sections: toggle(s.sections, k, v) })}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Label className="flex-1">Nudges during the day</Label>
            <Switch
              label="Nudges"
              checked={s.nudges.enabled}
              onChange={(v) => setS({ ...s, nudges: { ...s.nudges, enabled: v } })}
            />
          </div>
          <div className="flex flex-col gap-2">
            {NUDGE_KINDS.map((k) => (
              <div key={k} className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[14px]">{NUDGE_NAME[k].name}</p>
                  <p className="text-[12px] text-orv-muted">{NUDGE_NAME[k].line}</p>
                </div>
                <Switch
                  label={NUDGE_NAME[k].name}
                  disabled={!s.nudges.enabled}
                  checked={s.nudges.kinds.includes(k)}
                  onChange={(v) =>
                    setS({ ...s, nudges: { ...s.nudges, kinds: toggle(s.nudges.kinds, k, v) } })
                  }
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px]">At most a day</span>
              <select
                aria-label="Nudges a day"
                value={s.nudges.max}
                disabled={!s.nudges.enabled}
                onChange={(e) => setS({ ...s, nudges: { ...s.nudges, max: Number(e.target.value) } })}
                className="h-9 rounded-orv-md field-ring px-2 text-[14px]"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[12px] text-orv-faint">
              Only between your Brief time and 8 pm, never in quiet hours.
            </p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Home: the greeting, the weather and the day in a sentence. */
export function BriefCard() {
  const { brief, settings } = useBrief();
  if (!brief || !settings) return null;
  const w = brief.sections.find((s): s is BriefWeather => s.kind === 'weather');
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-5" aria-label="Brief">
      <div className="flex items-center gap-2">
        <Sunrise size={15} className="text-orv-accent" aria-hidden />
        <h2 className="flex-1 text-[14px] font-semibold">{brief.greeting ?? 'Brief'}</h2>
        {w ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-orv-muted">
            <SkyIcon code={w.code} size={15} /> {w.now ?? w.high}°
          </span>
        ) : null}
        <Link href="/brief" className="text-[12px] text-orv-accent hover:underline">
          Open
        </Link>
      </div>
      {brief.story ? (
        <p className="line-clamp-3 text-[14px] leading-relaxed">{brief.story}</p>
      ) : (
        <>
          <p className="text-[15px] font-semibold">{brief.headline}</p>
          <p className="text-[13px] text-orv-muted">{brief.line}</p>
        </>
      )}
      {!settings.enabled ? (
        <Link href="/brief?settings=1" className="text-[12px] text-orv-accent hover:underline">
          Get it every morning →
        </Link>
      ) : null}
    </Glass>
  );
}

export function BriefPageBody({ openSettings }: { openSettings: boolean }) {
  const { brief, settings, setSettings, setBrief, reload } = useBrief();
  const [sheet, setSheet] = useState(openSettings);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      {brief ? (
        <Hero
          b={brief}
          busy={busy}
          onRefresh={async () => {
            setBusy(true);
            await reload(true).finally(() => setBusy(false));
          }}
          onSettings={() => setSheet(true)}
        />
      ) : (
        <SkeletonRows rows={3} label="Building your Brief" />
      )}
      {settings && !settings.enabled ? (
        <Glass level="pane" className="flex flex-wrap items-center gap-3 p-4">
          <Sunrise size={18} className="text-orv-accent" aria-hidden />
          <p className="flex-1 text-[14px]">
            Get this every morning as one quiet notification, and only the nudges that matter during the day.
          </p>
          <Button variant="primary" size="sm" onClick={() => setSheet(true)}>
            Turn it on
          </Button>
        </Glass>
      ) : null}
      {settings && !settings.place && settings.sections.includes('weather') ? (
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex items-center gap-2 px-1 text-left text-[13px] text-orv-accent hover:underline"
        >
          <CloudSun size={15} /> Add your city for the weather
        </button>
      ) : null}
      {brief ? <BriefSections sections={brief.sections} onChange={setBrief} /> : null}
      {settings ? (
        <BriefSettingsSheet
          open={sheet}
          value={settings}
          onClose={() => setSheet(false)}
          onSaved={(s) => {
            setSettings(s);
            void reload(true);
          }}
        />
      ) : null}
    </div>
  );
}
