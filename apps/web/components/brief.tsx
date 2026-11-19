'use client';

import {
  BRIEF_SECTIONS,
  type BriefSection,
  type BriefSettings,
  type BriefView,
  formatMoney,
  NUDGE_KINDS,
} from '@orvyn/contracts';
import {
  ArrowDownToLine,
  BookOpen,
  CalendarDays,
  GitPullRequest,
  Mail,
  RefreshCw,
  Settings2,
  Sunrise,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Badge, Glass, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const SECTION_NAME: Record<(typeof BRIEF_SECTIONS)[number], string> = {
  agenda: 'Your day',
  money: 'Money',
  drop: 'Drop',
  library: 'Running out',
  work: 'From your tools',
  mail: 'Mail',
};
const NUDGE_NAME: Record<(typeof NUDGE_KINDS)[number], { name: string; line: string }> = {
  slipped: { name: 'Things that slipped', line: '3 or more overdue tasks, with “Move to today”' },
  budget: { name: 'Budget drifting', line: 'A budget at 80% early in the month, or used up' },
  payments: { name: 'Payments waiting', line: '5 or more captured payments not looked at' },
  drop: { name: 'Drop piling up', line: '3 or more things waiting for a day' },
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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
  return { brief, settings, setSettings, reload: load };
}

function Section({
  icon,
  title,
  children,
  href,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  href?: string;
}) {
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-5" aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="text-orv-accent">{icon}</span>
        <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
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
    <div className="flex items-baseline gap-3 py-1">
      <span className={muted ? 'flex-1 text-[14px] text-orv-muted' : 'flex-1 text-[14px]'}>{left}</span>
      {right ? <span className="text-[13px] tabular-nums text-orv-muted">{right}</span> : null}
    </div>
  );
}

export function BriefSections({ sections }: { sections: BriefSection[] }) {
  if (!sections.length) return <p className="text-small text-orv-muted">Nothing to report. A clear day.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((s) => {
        switch (s.kind) {
          case 'agenda':
            return (
              <Section
                key="agenda"
                icon={<CalendarDays size={15} />}
                title={SECTION_NAME.agenda}
                href="/today"
              >
                {s.events.length ? (
                  s.events.map((e, i) => (
                    <Row
                      key={i}
                      left={e.title}
                      right={
                        e.allDay || !e.at ? 'all day' : `${time(e.at)}${e.until ? `–${time(e.until)}` : ''}`
                      }
                    />
                  ))
                ) : (
                  <Row left="No meetings" muted />
                )}
                <div className="mt-1 border-t border-orv-edge pt-2">
                  <p className="text-[12px] text-orv-muted">
                    {s.dueToday} due today{s.overdue ? ` · ${s.overdue} overdue` : ''}
                  </p>
                  {s.top.map((t) => (
                    <Row
                      key={t.id}
                      left={t.title}
                      right={
                        t.overdue ? (
                          <Badge tone="warning">overdue</Badge>
                        ) : t.priority >= 3 ? (
                          <Badge tone="accent">high</Badge>
                        ) : null
                      }
                    />
                  ))}
                </div>
              </Section>
            );
          case 'money':
            return (
              <Section key="money" icon={<Wallet size={15} />} title={SECTION_NAME.money} href="/money">
                <Row left="Yesterday" right={formatMoney(s.yesterdayMinor)} />
                <Row left="This month" right={formatMoney(s.monthMinor)} />
                {s.budgets.map((b) => (
                  <Row
                    key={b.name}
                    left={`${b.name} budget`}
                    right={
                      <span
                        className={b.spentMinor >= b.amountMinor ? 'text-orv-danger' : 'text-orv-warning'}
                      >
                        {Math.round((b.spentMinor / b.amountMinor) * 100)}% of {formatMoney(b.amountMinor)}
                      </span>
                    }
                  />
                ))}
                {s.toReview ? <Row left={`${s.toReview} payments to look at`} muted /> : null}
              </Section>
            );
          case 'drop':
            return (
              <Section key="drop" icon={<ArrowDownToLine size={15} />} title={SECTION_NAME.drop} href="/drop">
                <Row
                  left={`${s.waiting} ${s.waiting === 1 ? 'thing waits' : 'things wait'} for a decision`}
                />
              </Section>
            );
          case 'library':
            return (
              <Section
                key="library"
                icon={<BookOpen size={15} />}
                title={SECTION_NAME.library}
                href="/library"
              >
                {s.expiring.map((d) => (
                  <Row key={d.id} left={d.title} right={d.days === 0 ? 'today' : `in ${d.days} d`} />
                ))}
              </Section>
            );
          case 'work':
            return (
              <Section key="work" icon={<GitPullRequest size={15} />} title={SECTION_NAME.work} href="/today">
                {s.reviews ? <Row left="Reviews waiting for you" right={s.reviews} /> : null}
                {s.issues ? <Row left="GitHub issues assigned" right={s.issues} /> : null}
                {s.clickup ? (
                  <Row
                    left="ClickUp tasks"
                    right={s.clickupDueToday ? `${s.clickup} · ${s.clickupDueToday} due` : s.clickup}
                  />
                ) : null}
              </Section>
            );
          case 'mail':
            return (
              <Section key="mail" icon={<Mail size={15} />} title={SECTION_NAME.mail} href="/">
                {s.boxes.map((b) => (
                  <Row key={b.account} left={b.account} right={`${b.unread} unread`} />
                ))}
              </Section>
            );
        }
      })}
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
      subtitle="Written from what is already in ORVYN — no AI, nothing leaves the server."
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
        <div className="flex items-center gap-3">
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
            className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-2 text-[14px]"
          />
          <Switch label="Morning Brief" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
        </div>
        <div>
          <Label className="mb-2 block">What it carries</Label>
          <div className="flex flex-col gap-2">
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
                className="h-9 rounded-orv-md border border-orv-edge bg-orv-field px-2 text-[14px]"
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

/** Home: the Brief's headline, or an invitation to turn it on. */
export function BriefCard() {
  const { brief, settings } = useBrief();
  if (!brief || !settings) return null;
  return (
    <Glass level="pane" as="section" className="flex flex-col gap-2 p-5" aria-label="Brief">
      <div className="flex items-center gap-2">
        <Sunrise size={15} className="text-orv-accent" aria-hidden />
        <h2 className="flex-1 text-[14px] font-semibold">Brief</h2>
        <Link href="/brief" className="text-[12px] text-orv-accent hover:underline">
          Open
        </Link>
      </div>
      <p className="text-[15px] font-semibold">{brief.headline}</p>
      <p className="text-[13px] text-orv-muted">{brief.line}</p>
      {!settings.enabled ? (
        <Link href="/brief?settings=1" className="text-[12px] text-orv-accent hover:underline">
          Get it every morning →
        </Link>
      ) : null}
    </Glass>
  );
}

export function BriefPageBody({ openSettings }: { openSettings: boolean }) {
  const { brief, settings, setSettings, reload } = useBrief();
  const [sheet, setSheet] = useState(openSettings);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div className="flex flex-col gap-1">
          <span className="text-small text-orv-muted">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1 className="text-title font-semibold">{brief ? brief.headline : 'Your Brief'}</h1>
          {brief ? <p className="text-small text-orv-muted">{brief.line}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await reload(true).finally(() => setBusy(false));
            }}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSheet(true)} disabled={!settings}>
            <Settings2 size={14} /> Settings
          </Button>
        </div>
      </header>
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
      {brief ? (
        <BriefSections sections={brief.sections} />
      ) : (
        <SkeletonRows rows={4} label="Building your Brief" />
      )}
      {settings ? (
        <BriefSettingsSheet
          open={sheet}
          value={settings}
          onClose={() => setSheet(false)}
          onSaved={setSettings}
        />
      ) : null}
    </div>
  );
}
