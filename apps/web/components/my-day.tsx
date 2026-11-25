'use client';

import { duration } from '@orvyn/activity';
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityDay,
  type ActivityDaySummary,
  type ActivityRules,
  type ActivityStory,
} from '@orvyn/contracts';
import { ChevronLeft, ChevronRight, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Glass, Label, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { localDay } from '@/lib/today';

/**
 * My Day (spec 0020): where the day went. Three kinds of time keep the charts readable; the exact category is in words.
 */
type Kind = 'work' | 'talk' | 'off';
const KIND: Record<ActivityCategory, Kind> = {
  code: 'work',
  work: 'work',
  meeting: 'work',
  learning: 'work',
  research: 'work',
  ai: 'work',
  jobs: 'work',
  messages: 'talk',
  mail: 'talk',
  money: 'off',
  shopping: 'off',
  social: 'off',
  video: 'off',
  music: 'off',
  games: 'off',
  system: 'off',
  other: 'off',
};
const KINDS: { id: Kind; name: string; color: string }[] = [
  { id: 'work', name: 'Work and learning', color: 'var(--orv-label-sky)' },
  { id: 'talk', name: 'Messages and mail', color: 'var(--orv-label-amber)' },
  { id: 'off', name: 'Everything else', color: 'var(--orv-label-slate)' },
];
const color = (c: ActivityCategory) => KINDS.find((k) => k.id === KIND[c])!.color;

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDay(d);
};
const ms = (b: { start: string; end: string }) => Date.parse(b.end) - Date.parse(b.start);

export function MyDay() {
  const today = localDay(new Date());
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<ActivityDay | null>(null);
  const [week, setWeek] = useState<ActivityDaySummary[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [story, setStory] = useState<ActivityStory | null>(null);
  const [writing, setWriting] = useState(false);
  const [rules, setRules] = useState<ActivityRules>({ categories: {}, blocked: [] });
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [d, w] = await Promise.all([
        api<ActivityDay>(`/activity/day?date=${date}&tz=${encodeURIComponent(tz())}`),
        api<ActivityDaySummary[]>(
          `/activity/range?from=${shift(date, -6)}&to=${date}&tz=${encodeURIComponent(tz())}`,
        ),
      ]);
      setDay(d);
      setWeek(w);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'You are offline.');
    }
  }, [date]);
  useEffect(() => {
    setStory(null);
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    api<ActivityRules>('/activity/rules').then(setRules, () => undefined);
  }, []);

  const saveRules = async (next: ActivityRules) => {
    try {
      setRules(await api<ActivityRules>('/activity/rules', { method: 'PUT', body: next }));
      await load();
    } catch {
      toast({ title: 'That did not save. Try again.' });
    }
  };
  const tell = async () => {
    setWriting(true);
    try {
      setStory(await api<ActivityStory>('/activity/story', { method: 'POST', body: { date, tz: tz() } }));
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'You are offline.' });
    }
    setWriting(false);
  };
  const remove = async () => {
    if (!day || !window.confirm(`Delete everything recorded on ${day.date}? This cannot be undone.`)) return;
    const from = new Date(`${day.date}T00:00:00`);
    const to = new Date(`${shift(day.date, 1)}T00:00:00`);
    await api(`/activity?from=${from.toISOString()}&to=${to.toISOString()}`, { method: 'DELETE' }).catch(() =>
      toast({ title: 'That did not work. Try again.' }),
    );
    await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-title mr-auto font-semibold">My Day</h1>
        <Button size="sm" aria-label="Day before" onClick={() => setDate(shift(date, -1))}>
          <ChevronLeft size={16} />
        </Button>
        <input
          type="date"
          aria-label="Day"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-9 rounded-orv-sm border border-orv-edge bg-orv-field px-2 text-[14px]"
        />
        <Button
          size="sm"
          aria-label="Day after"
          disabled={date >= today}
          onClick={() => setDate(shift(date, 1))}
        >
          <ChevronRight size={16} />
        </Button>
      </header>
      {problem ? (
        <p role="alert" className="text-orv-danger">
          {problem}
        </p>
      ) : null}
      {!day ? (
        problem ? null : (
          <div className="skeleton h-40 rounded-orv-md" aria-label="Loading" />
        )
      ) : day.activeMs + day.awayMs === 0 ? (
        <Glass className="p-6 text-orv-muted">
          <p>
            Nothing was recorded on this day. ORVYN for Chrome records the sites; ORVYN for Windows will add
            the programs and when you were away.
          </p>
        </Glass>
      ) : (
        <>
          <Tiles d={day} />
          <Strip d={day} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Hours d={day} />
            <Week days={week} date={date} onPick={setDate} />
          </div>
          <Glass className="p-5" as="section" aria-label="The story">
            <div className="flex items-center gap-3">
              <Label className="mr-auto">The story</Label>
              <Button size="sm" loading={writing} onClick={() => void tell()}>
                <Sparkles size={14} aria-hidden /> {story ? 'Write it again' : 'Tell me how it went'}
              </Button>
            </div>
            {story ? (
              <div className="mt-3 flex flex-col gap-2 text-[15px]">
                <p>{story.story}</p>
                {story.wins.map((w) => (
                  <p key={w}>
                    <Badge tone="success">Went well</Badge> {w}
                  </p>
                ))}
                {story.leaks.map((w) => (
                  <p key={w}>
                    <Badge tone="warning">Slipped</Badge> {w}
                  </p>
                ))}
                {story.tomorrow ? (
                  <p>
                    <Badge tone="accent">Tomorrow</Badge> {story.tomorrow}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[14px] text-orv-muted">
                Written by AI only when you ask, from names and durations.
              </p>
            )}
          </Glass>
          <div className="grid gap-4 lg:grid-cols-2">
            <Places d={day} rules={rules} onRules={saveRules} />
            <Timeline d={day} />
          </div>
          <Shielded rules={rules} onRules={saveRules} />
          <div>
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              <Trash2 size={14} aria-hidden /> Delete this day
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Tiles({ d }: { d: ActivityDay }) {
  const tiles: [string, string, string][] = [
    ['Active', duration(d.activeMs), `${duration(d.awayMs)} away`],
    [
      'Deep work',
      duration(d.deepMs),
      `${d.deep.length} ${d.deep.length === 1 ? 'run' : 'runs'} of 25 min or more`,
    ],
    ['From – to', d.firstAt && d.lastAt ? `${clock(d.firstAt)} – ${clock(d.lastAt)}` : '—', ''],
    [
      'Switches',
      String(d.switches),
      d.switches ? `one every ${duration(d.activeMs / Math.max(1, d.switches))}` : '',
    ],
    [
      'Hands',
      `${d.keys.toLocaleString('en-IN')} keys`,
      `${d.clicks.toLocaleString('en-IN')} ${d.clicks === 1 ? 'click' : 'clicks'}`,
    ],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map(([k, v, sub]) => (
        <Glass key={k} className="p-4">
          <dt className="text-[12px] text-orv-muted">{k}</dt>
          <dd className="text-[18px] font-semibold tabular-nums">{v}</dd>
          <p className="text-[12px] text-orv-muted">{sub}</p>
        </Glass>
      ))}
    </dl>
  );
}

/** The day as one strip, first to last minute. */
function Strip({ d }: { d: ActivityDay }) {
  const [at, setAt] = useState<number | null>(null);
  if (!d.blocks.length) return null;
  const from = Date.parse(d.blocks[0]!.start);
  const to = Date.parse(d.blocks.at(-1)!.end);
  const span = Math.max(1, to - from);
  const b = at === null ? null : d.blocks[at];
  return (
    <Glass className="p-5" as="section" aria-label="The day in one line">
      <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-orv-muted">
        {KINDS.map((k) => (
          <span key={k.id} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-orv-xs" style={{ background: k.color }} />
            {k.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-orv-xs bg-orv-track" /> Away
        </span>
      </div>
      <div
        className="relative h-9 overflow-hidden rounded-orv-sm bg-orv-track"
        onPointerLeave={() => setAt(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = from + ((e.clientX - r.left) / r.width) * span;
          const i = d.blocks.findIndex((x) => Date.parse(x.start) <= t && t < Date.parse(x.end));
          setAt(i < 0 ? null : i);
        }}
      >
        {d.blocks.map((x, i) =>
          x.kind === 'away' || x.kind === 'locked' ? null : (
            <span
              key={x.start}
              className={cn('absolute inset-y-0', at === i && 'brightness-125')}
              style={{
                left: `${((Date.parse(x.start) - from) / span) * 100}%`,
                width: `max(1px, ${(ms(x) / span) * 100}%)`,
                background: color(x.category),
              }}
            />
          ),
        )}
      </div>
      <div className="mt-1 flex justify-between text-[12px] tabular-nums text-orv-muted">
        <span>{clock(d.blocks[0]!.start)}</span>
        <span className="truncate px-2 text-orv-text">
          {b ? `${clock(b.start)}–${clock(b.end)} · ${b.place}${b.what ? `: ${b.what}` : ''}` : ''}
        </span>
        <span>{clock(d.blocks.at(-1)!.end)}</span>
      </div>
    </Glass>
  );
}

const HOUR = 3_600_000;
function Hours({ d }: { d: ActivityDay }) {
  const used = d.hours.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const lo = Math.min(...used, 9);
  const hi = Math.max(...used, 18);
  return (
    <Glass className="p-5" as="section" aria-label="Active time by hour">
      <Label>Active time by hour</Label>
      <div className="mt-3 flex h-32 items-end gap-0.5 border-b border-orv-hairline">
        {d.hours.slice(lo, hi + 1).map((v, i) => (
          <div
            key={i}
            className="flex h-full flex-1 items-end justify-center"
            title={`${lo + i}:00 · ${duration(v)}`}
          >
            <span
              className="w-full max-w-5 rounded-t-orv-xs"
              style={{ height: `${Math.min(100, (v / HOUR) * 100)}%`, background: KINDS[0]!.color }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-orv-muted">
        <span>{lo}:00</span>
        <span>full height = 60 min</span>
        <span>{hi}:00</span>
      </div>
    </Glass>
  );
}

function Week({ days, date, onPick }: { days: ActivityDaySummary[]; date: string; onPick(d: string): void }) {
  const top = Math.max(HOUR, ...days.map((x) => x.activeMs));
  return (
    <Glass className="p-5" as="section" aria-label="These seven days">
      <Label>These seven days</Label>
      <table className="mt-2 w-full text-[13px]">
        <thead className="text-left text-[11px] text-orv-muted">
          <tr>
            <th className="font-medium">Day</th>
            <th className="w-1/2 font-medium">Active</th>
            <th className="text-right font-medium">Deep</th>
          </tr>
        </thead>
        <tbody>
          {days.map((x) => (
            <tr key={x.date} className={x.date === date ? 'font-semibold' : ''}>
              <td>
                <button className="py-1 hover:text-orv-accent" onClick={() => onPick(x.date)}>
                  {new Date(`${x.date}T12:00:00`).toLocaleDateString([], {
                    weekday: 'short',
                    day: 'numeric',
                  })}
                </button>
              </td>
              <td>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 rounded-r-orv-xs"
                    style={{ width: `${(x.activeMs / top) * 60}%`, background: KINDS[0]!.color }}
                  />
                  <span className="whitespace-nowrap tabular-nums">{duration(x.activeMs)}</span>
                </span>
              </td>
              <td className="text-right tabular-nums">{duration(x.deepMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Glass>
  );
}

function Places({
  d,
  rules,
  onRules,
}: {
  d: ActivityDay;
  rules: ActivityRules;
  onRules(r: ActivityRules): Promise<void>;
}) {
  return (
    <Glass className="p-5" as="section" aria-label="Places">
      <Label>Where the time went</Label>
      <ul className="mt-2 flex flex-col">
        {d.places.slice(0, 20).map((p) => (
          <li key={p.place} className="border-b border-orv-hairline py-2 last:border-0">
            <details>
              <summary className="flex cursor-pointer items-center gap-2 text-[14px]">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-orv-xs"
                  style={{ background: color(p.category) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {p.place} <span className="text-orv-muted">· {p.category}</span>
                </span>
                <span className="tabular-nums">{duration(p.ms)}</span>
              </summary>
              <div className="mt-1 pl-5 text-[13px] text-orv-muted">
                {p.whats.map((w) => (
                  <p key={w.what} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{w.what}</span>
                    <span className="tabular-nums">{duration(w.ms)}</span>
                  </p>
                ))}
                {p.key ? (
                  <label className="mt-1 flex items-center gap-2">
                    Counts as
                    <select
                      aria-label={`What ${p.place} counts as`}
                      value={p.category}
                      onChange={(e) =>
                        void onRules({
                          ...rules,
                          categories: { ...rules.categories, [p.key]: e.target.value as ActivityCategory },
                        })
                      }
                      className="rounded-orv-sm border border-orv-edge bg-orv-field px-1"
                    >
                      {ACTIVITY_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Glass>
  );
}

function Timeline({ d }: { d: ActivityDay }) {
  const [all, setAll] = useState(false);
  const rows = all ? d.blocks : d.blocks.filter((b) => ms(b) >= 120_000);
  return (
    <Glass className="p-5" as="section" aria-label="Minute by minute">
      <div className="flex items-center">
        <Label className="mr-auto">Minute by minute</Label>
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
          {all ? 'Only 2 min or more' : `All ${d.blocks.length}`}
        </Button>
      </div>
      <ol className="mt-2 max-h-[560px] overflow-y-auto">
        {rows.map((b) => (
          <li key={b.start} className="flex gap-3 py-1 text-[13px]">
            <span className="w-32 shrink-0 tabular-nums text-orv-muted">
              {clock(b.start)} – {clock(b.end)}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1',
                b.kind === 'away' || b.kind === 'locked' ? 'text-orv-muted' : '',
              )}
            >
              <span className="block truncate">
                {b.place}
                {b.what ? <span className="text-orv-muted"> · {b.what}</span> : null}
              </span>
              {b.keys + b.clicks > 0 ? (
                <span className="text-[11px] text-orv-muted">
                  {b.keys} keys, {b.clicks} clicks
                </span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">{duration(ms(b))}</span>
          </li>
        ))}
      </ol>
    </Glass>
  );
}

function Shielded({ rules, onRules }: { rules: ActivityRules; onRules(r: ActivityRules): Promise<void> }) {
  const [text, setText] = useState('');
  useEffect(() => setText(rules.blocked.join(', ')), [rules.blocked]);
  return (
    <Glass className="p-5" as="section" aria-label="Focus shield">
      <Label>Focus shield</Label>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const blocked = text
            .split(/[\s,]+/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 200);
          void onRules({ ...rules, blocked });
        }}
      >
        <input
          aria-label="Sites held back during focus"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Empty: the usual ones (Instagram, YouTube, Reddit…)"
          className="h-9 min-w-60 flex-1 rounded-orv-sm border border-orv-edge bg-orv-field px-3 text-[14px]"
        />
        <Button size="sm" type="submit">
          Save
        </Button>
      </form>
    </Glass>
  );
}
