import type { ActivityCategory, ActivityDay, ActivityRules, ActivitySpan, DayBlock } from '@orvyn/contracts';

/**
 * From raw spans to a day (spec 0020, ADR-0018). Pure: the same rules in the API, the extension and the web app.
 */

// ------------------------------------------------------------------ what a page is

const strip = (title: string, tail: RegExp) =>
  title
    .replace(tail, '')
    .replace(/^\(\d+\+?\)\s*/, '')
    .trim();
const SEARCH = /^(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com)$/;

export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** Where this is and what is being done there, in words. */
export function describe(s: Pick<ActivitySpan, 'app' | 'host' | 'path' | 'title' | 'q'>): {
  place: string;
  what: string;
} {
  const host = bareHost(s.host);
  const t = s.title.trim();
  if (!host) return describeApp(s.app, t);
  const seg = s.path.split('/').filter(Boolean);
  if (SEARCH.test(host) && s.q) return { place: 'Search', what: s.q };
  switch (host) {
    case 'github.com': {
      const repo = seg.slice(0, 2).join('/');
      const n = seg[3];
      const reviewing = seg[4] === 'files' || seg[4] === 'changes' ? ' (reviewing)' : '';
      if (seg[2] === 'pull' && n) return { place: 'GitHub', what: `PR #${n} · ${repo}${reviewing}` };
      if (seg[2] === 'issues' && n) return { place: 'GitHub', what: `Issue #${n} · ${repo}` };
      if (seg[2] === 'blob') return { place: 'GitHub', what: `${seg.at(-1)} · ${repo}` };
      if (seg[2] === 'actions') return { place: 'GitHub', what: `CI · ${repo}` };
      return { place: 'GitHub', what: repo || 'GitHub' };
    }
    case 'youtube.com':
    case 'music.youtube.com':
      return {
        place: host === 'youtube.com' ? 'YouTube' : 'YouTube Music',
        what: seg[0] === 'shorts' ? 'Shorts' : strip(t, /\s*-\s*YouTube( Music)?$/) || 'Browsing',
      };
    case 'mail.google.com':
      return { place: 'Gmail', what: strip(t, /\s*-\s*[^\s]+@[^\s]+(\s*-.*)?$/) || 'Mail' };
    case 'meet.google.com':
      return { place: 'Google Meet', what: t.replace(/^Meet\s*[-–]\s*/, '') || 'Meeting' };
    case 'calendar.google.com':
      return { place: 'Google Calendar', what: 'Calendar' };
    case 'docs.google.com': {
      const kinds: Record<string, string> = {
        spreadsheets: 'Google Sheets',
        presentation: 'Google Slides',
        forms: 'Google Forms',
      };
      const kind = kinds[seg[0] ?? ''] ?? 'Google Docs';
      return { place: kind, what: strip(t, /\s*-\s*Google (Docs|Sheets|Slides|Forms)$/) || kind };
    }
    case 'app.clickup.com':
      return { place: 'ClickUp', what: strip(t, /\s*\|\s*ClickUp$/) || 'ClickUp' };
    case 'web.whatsapp.com':
      return { place: 'WhatsApp', what: 'Chats' };
    case 'chatgpt.com':
    case 'claude.ai':
    case 'gemini.google.com': {
      const name = host === 'chatgpt.com' ? 'ChatGPT' : host === 'claude.ai' ? 'Claude' : 'Gemini';
      return { place: name, what: strip(t, /\s*[-–|]\s*(Claude|ChatGPT|Gemini)$/) || 'Conversation' };
    }
    case 'linkedin.com': {
      const kinds: Record<string, string> = {
        jobs: 'Jobs',
        messaging: 'Messages',
        in: 'A profile',
        feed: 'Feed',
      };
      return {
        place: 'LinkedIn',
        what: kinds[seg[0] ?? ''] ?? (strip(t, /\s*\|\s*LinkedIn$/) || 'LinkedIn'),
      };
    }
    case 'stackoverflow.com':
      return { place: 'Stack Overflow', what: strip(t, /\s*-\s*Stack Overflow$/) };
    case 'localhost':
    case '127.0.0.1':
      return { place: 'Local site', what: t || 'localhost' };
    default:
      return { place: host, what: t || host };
  }
}

const APPS: Record<string, string> = {
  code: 'VS Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  studio64: 'Android Studio',
  devenv: 'Visual Studio',
  chrome: 'Chrome',
  msedge: 'Edge',
  brave: 'Brave',
  firefox: 'Firefox',
  explorer: 'File Explorer',
  windowsterminal: 'Terminal',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  slack: 'Slack',
  teams: 'Teams',
  'ms-teams': 'Teams',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  'whatsapp.root': 'WhatsApp',
  spotify: 'Spotify',
  vlc: 'VLC',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  outlook: 'Outlook',
  olk: 'Outlook',
  notion: 'Notion',
  figma: 'Figma',
  postman: 'Postman',
  zoom: 'Zoom',
  notepad: 'Notepad',
  clickup: 'ClickUp',
  claude: 'Claude',
};

function describeApp(app: string, title: string): { place: string; what: string } {
  const exe = app.replace(/\.exe$/i, '');
  const name = APPS[exe.toLowerCase()] ?? (exe || 'Computer');
  if (/^(code|cursor|antigravity|devenv|idea64|pycharm64|webstorm64)$/i.test(exe)) {
    // "● spec.md - orvyn - Visual Studio Code" → project first
    const p = title.replace(/^[●•]\s*/, '').split(' - ');
    if (p.length >= 3) return { place: name, what: `${p.at(-2)} · ${p[0]}` };
  }
  if (/^studio64$/i.test(exe)) {
    // "orvyn – MainActivity.kt [orvyn.app.main]" is already project first
    return { place: name, what: title.replace(/\s*\[[^\]]*\]$/, '').replace(/\s+–\s+/, ' · ') || name };
  }
  const tail = new RegExp(`\\s*[-–—|]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return { place: name, what: title.replace(tail, '').trim() || name };
}

export const BROWSERS = /^(chrome|msedge|brave|opera|vivaldi|arc)(\.exe)?$/i;

const BY_HOST: [RegExp, ActivityCategory][] = [
  [
    /^(.*\.)?(github|gitlab|bitbucket|vercel|npmjs|railway|render|supabase|docker|sentry)\.(com|org|io|dev)$/,
    'code',
  ],
  [/^(console\.cloud\.google\.com|.*console\.aws\.amazon\.com|localhost|127\.0\.0\.1)$/, 'code'],
  [/^(meet\.google\.com|.*\.zoom\.us|teams\.(microsoft|live)\.com)$/, 'meeting'],
  [/^(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.zoho\.(in|com))$/, 'mail'],
  [
    /^(web\.whatsapp\.com|web\.telegram\.org|app\.slack\.com|discord\.com|messages\.google\.com)$/,
    'messages',
  ],
  [/^(chatgpt\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|.*\.openai\.com|openrouter\.ai)$/, 'ai'],
  [
    /^(app\.clickup\.com|docs\.google\.com|calendar\.google\.com|drive\.google\.com|notion\.so|.*\.notion\.site)$/,
    'work',
  ],
  [/^(figma\.com|.*\.atlassian\.net|linear\.app|trello\.com|miro\.com|orvyn\.dubey\.app)$/, 'work'],
  [
    /^(stackoverflow\.com|.*\.stackexchange\.com|developer\.mozilla\.org|.*\.readthedocs\.io|learn\.microsoft\.com)$/,
    'learning',
  ],
  [
    /^(coursera\.org|udemy\.com|leetcode\.com|geeksforgeeks\.org|.*\.wikipedia\.org|medium\.com|dev\.to|arxiv\.org|docs\..+)$/,
    'learning',
  ],
  [/^(.*\.)?(naukri\.com|indeed\.(com|co\.in)|greenhouse\.io|myworkdayjobs\.com)$/, 'jobs'],
  [/^(wellfound\.com|jobs\.lever\.co|jobs\.ashbyhq\.com|instahyre\.com|cutshort\.io)$/, 'jobs'],
  [/^(.*\.)?(hdfcbank|icicibank|sbi|onlinesbi|axisbank|kotak|idfcfirstbank)\.(com|co\.in|sbi)$/, 'money'],
  [/^(.*\.)?(zerodha\.com|groww\.in|upstox\.com)$/, 'money'],
  [/^(.*\.)?(amazon\.(in|com)|flipkart\.com|myntra\.com|ajio\.com|meesho\.com)$/, 'shopping'],
  [/^(.*\.)?(blinkit\.com|zeptonow\.com|swiggy\.com|zomato\.com|bigbasket\.com)$/, 'shopping'],
  [
    /^(.*\.)?(instagram|facebook|twitter|x|reddit|threads|linkedin|snapchat|pinterest|quora)\.(com|net)$/,
    'social',
  ],
  [/^(open\.spotify\.com|music\.youtube\.com|soundcloud\.com|gaana\.com|jiosaavn\.com)$/, 'music'],
  [/^(.*\.)?(youtube|netflix|primevideo|hotstar|jiocinema|sonyliv|twitch|vimeo)\.(com|tv)$/, 'video'],
  [/^(chess\.com|lichess\.org|poki\.com|store\.steampowered\.com)$/, 'games'],
];
const BY_APP: [RegExp, ActivityCategory][] = [
  [
    /^(code|cursor|antigravity|studio64|devenv|idea64|pycharm64|webstorm64|windowsterminal|powershell|pwsh|cmd|postman|docker desktop|dbeaver)$/i,
    'code',
  ],
  [/^(zoom|teams|ms-teams)$/i, 'meeting'],
  [/^(slack|discord|telegram|whatsapp|whatsapp\.root)$/i, 'messages'],
  [/^(outlook|olk|thunderbird)$/i, 'mail'],
  [/^(winword|excel|powerpnt|notion|figma|clickup|acrobat|acrord32|onenote)$/i, 'work'],
  [/^(claude|chatgpt)$/i, 'ai'],
  [/^spotify$/i, 'music'],
  [/^(vlc|netflix|mpc-hc64|potplayermini64)$/i, 'video'],
  [/^(steam|epicgameslauncher)$/i, 'games'],
  [
    /^(explorer|systemsettings|taskmgr|searchhost|shellexperiencehost|applicationframehost|lockapp)$/i,
    'system',
  ],
];

/** True when `host` is `rule` or inside it ("docs.github.com" is inside "github.com"). */
export const inside = (host: string, rule: string) => {
  const h = bareHost(host);
  const r = bareHost(rule);
  return h === r || h.endsWith(`.${r}`);
};

export function categorize(
  s: Pick<ActivitySpan, 'app' | 'host' | 'path'>,
  rules?: Partial<ActivityRules>,
): ActivityCategory {
  const host = bareHost(s.host);
  const exe = s.app.replace(/\.exe$/i, '');
  const own = Object.entries(rules?.categories ?? {}).filter(([k]) =>
    host ? inside(host, k) : k.replace(/\.exe$/i, '').toLowerCase() === exe.toLowerCase(),
  );
  // the most exact rule wins
  if (own.length) return own.sort((a, b) => b[0].length - a[0].length)[0]![1];
  if (host) {
    if (SEARCH.test(host)) return 'research';
    if (host === 'linkedin.com' && s.path.startsWith('/jobs')) return 'jobs';
    return BY_HOST.find(([re]) => re.test(host))?.[1] ?? 'other';
  }
  return BY_APP.find(([re]) => re.test(exe))?.[1] ?? 'other';
}

/** What is safe to keep of an address: host, path and, on a search page, the words searched. */
export function place(url: string): { host: string; path: string; q: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.slice(0, 253);
  const q = SEARCH.test(bareHost(host)) ? (u.searchParams.get('q') ?? '').slice(0, 200) : '';
  return { host, path: u.pathname.slice(0, 500), q };
}

// ------------------------------------------------------------------ a day

const WORKING: ReadonlySet<ActivityCategory> = new Set([
  'code',
  'work',
  'meeting',
  'learning',
  'research',
  'ai',
  'jobs',
]);
const DEEP_MS = 25 * 60_000;
const DEEP_GAP_MS = 2 * 60_000;

interface Piece {
  from: number;
  to: number;
  s: ActivitySpan;
}

/** Cut to the window; where spans overlap one is chosen, so no minute counts twice. */
export function flatten(spans: ActivitySpan[], from: number, to: number): Piece[] {
  const pieces = spans
    .map((s) => ({ from: Math.max(Date.parse(s.start), from), to: Math.min(Date.parse(s.end), to), s }))
    .filter((p) => p.to > p.from)
    .sort((x, y) => x.from - y.from);
  const cuts = [...new Set(pieces.flatMap((p) => [p.from, p.to]))].sort((x, y) => x - y);
  const out: Piece[] = [];
  let open: Piece[] = [];
  let i = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const x = cuts[c]!;
    const y = cuts[c + 1]!;
    open = open.filter((p) => p.to > x);
    while (i < pieces.length && pieces[i]!.from <= x) open.push(pieces[i++]!);
    const s = choose(open);
    if (!s) continue;
    const last = out.at(-1);
    if (last && last.s === s && last.to === x) last.to = y;
    else out.push({ from: x, to: y, s });
  }
  return out;
}

/**
 * Who speaks for this moment. The PC knows whether anyone is there and which program is in front; the browser knows
 * which page. So: away on the PC wins (unless something is playing in the browser); a browser in front is described
 * by its page; any other program by itself; without a PC, the browser.
 */
function choose(open: Piece[]): ActivitySpan | null {
  const newest = (src: 'pc' | 'web') => {
    let best: Piece | null = null;
    for (const p of open) if (p.s.source === src && (!best || p.from >= best.from)) best = p;
    return best?.s ?? null;
  };
  const pc = newest('pc');
  const web = newest('web');
  if (!pc) return web;
  if (pc.kind === 'locked') return pc;
  if (pc.kind === 'away') return web?.kind === 'media' ? web : pc;
  if (BROWSERS.test(pc.app) && web) return web.kind === 'away' ? pc : web;
  return pc;
}

export function buildDay(
  date: string,
  spans: ActivitySpan[],
  o: { from: number; to: number; hourOf(ms: number): number; rules?: Partial<ActivityRules> },
): ActivityDay {
  const blocks: DayBlock[] = [];
  for (const f of flatten(spans, o.from, o.to)) {
    const gone = f.s.kind === 'away' || f.s.kind === 'locked';
    const d = gone ? { place: f.s.kind === 'locked' ? 'Locked' : 'Away', what: '' } : describe(f.s);
    const whole = Math.max(1, Date.parse(f.s.end) - Date.parse(f.s.start));
    const n = (v: number) => Math.round((v * (f.to - f.from)) / whole);
    const last = blocks.at(-1);
    if (
      last &&
      last.place === d.place &&
      last.what === d.what &&
      last.kind === f.s.kind &&
      f.from - Date.parse(last.end) < 30_000
    ) {
      last.end = new Date(f.to).toISOString();
      last.keys += n(f.s.keys);
      last.clicks += n(f.s.clicks);
      last.scrolls += n(f.s.scrolls);
      continue;
    }
    blocks.push({
      start: new Date(f.from).toISOString(),
      end: new Date(f.to).toISOString(),
      kind: f.s.kind,
      ...d,
      key: gone ? '' : bareHost(f.s.host) || f.s.app,
      category: gone ? 'other' : categorize(f.s, o.rules),
      keys: n(f.s.keys),
      clicks: n(f.s.clicks),
      scrolls: n(f.s.scrolls),
    });
  }
  const here = blocks.filter((b) => b.kind === 'active' || b.kind === 'media');
  const cats = new Map<ActivityCategory, number>();
  const places = new Map<
    string,
    {
      place: string;
      key: string;
      category: ActivityCategory;
      ms: number;
      visits: number;
      whats: Map<string, number>;
    }
  >();
  const hours = new Array<number>(24).fill(0);
  let switches = 0;
  let prev = '';
  for (const b of here) {
    const d = len(b);
    cats.set(b.category, (cats.get(b.category) ?? 0) + d);
    const p = places.get(b.place) ?? {
      place: b.place,
      key: b.key,
      category: b.category,
      ms: 0,
      visits: 0,
      whats: new Map<string, number>(),
    };
    p.ms += d;
    if (prev !== b.place) {
      p.visits++;
      if (prev) switches++;
    }
    prev = b.place;
    if (b.what) p.whats.set(b.what, (p.whats.get(b.what) ?? 0) + d);
    places.set(b.place, p);
    // spread over the hours it covers (time zones differ by quarter hours at most)
    for (let t = Date.parse(b.start); t < Date.parse(b.end);) {
      const next = Math.min(Date.parse(b.end), (Math.floor(t / 900_000) + 1) * 900_000);
      hours[o.hourOf(t)]! += next - t;
      t = next;
    }
  }
  const deep = deepRuns(here);
  const sum = (k: 'keys' | 'clicks' | 'scrolls') => here.reduce((a, b) => a + b[k], 0);
  return {
    date,
    firstAt: here[0]?.start ?? null,
    lastAt: here.at(-1)?.end ?? null,
    activeMs: here.reduce((a, b) => a + len(b), 0),
    awayMs: blocks.reduce((a, b) => a + (b.kind === 'away' || b.kind === 'locked' ? len(b) : 0), 0),
    byCategory: [...cats].map(([category, ms]) => ({ category, ms })).sort((a, b) => b.ms - a.ms),
    places: [...places.values()]
      .sort((a, b) => b.ms - a.ms)
      .map((p) => ({
        ...p,
        whats: [...p.whats]
          .map(([what, ms]) => ({ what, ms }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 8),
      })),
    blocks,
    deep,
    deepMs: deep.reduce((a, d) => a + d.ms, 0),
    switches,
    hours,
    keys: sum('keys'),
    clicks: sum('clicks'),
    scrolls: sum('scrolls'),
  };
}

const len = (b: { start: string; end: string }) => Date.parse(b.end) - Date.parse(b.start);

/** Long runs of work: short visits elsewhere (under two minutes) don't end one, but don't count in it either. */
function deepRuns(here: DayBlock[]): ActivityDay['deep'] {
  interface Run {
    start: number;
    end: number;
    ms: number;
    cats: Map<ActivityCategory, number>;
    whats: Map<string, number>;
  }
  const runs: Run[] = [];
  for (const b of here) {
    if (!WORKING.has(b.category)) continue;
    const from = Date.parse(b.start);
    const to = Date.parse(b.end);
    let run = runs.at(-1);
    if (!run || from - run.end > DEEP_GAP_MS)
      runs.push((run = { start: from, end: to, ms: 0, cats: new Map(), whats: new Map() }));
    run.end = to;
    run.ms += to - from;
    run.cats.set(b.category, (run.cats.get(b.category) ?? 0) + to - from);
    const w = b.what || b.place;
    run.whats.set(w, (run.whats.get(w) ?? 0) + to - from);
  }
  return runs
    .filter((r) => r.ms >= DEEP_MS)
    .map((r) => ({
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
      ms: r.ms,
      category: [...r.cats].sort((a, b) => b[1] - a[1])[0]![0],
      whats: [...r.whats]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => w),
    }));
}

/** "3 h 5 min" */
export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return ms > 0 ? 'under a minute' : '0 min';
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

/** The day in lines, for its story: names and durations only (no paths, no raw spans). */
export function dayLines(d: ActivityDay, clock: (iso: string) => string): string {
  const l: string[] = [];
  if (d.firstAt && d.lastAt)
    l.push(
      `At the computer from ${clock(d.firstAt)} to ${clock(d.lastAt)}: ${duration(d.activeMs)} active, ${duration(d.awayMs)} away.`,
    );
  l.push(
    `Switched places ${d.switches} times. Deep work: ${duration(d.deepMs)} in ${d.deep.length} runs.`,
    ...d.byCategory.map((c) => `- ${c.category}: ${duration(c.ms)}`),
    'Places:',
  );
  for (const p of d.places.slice(0, 14)) {
    const whats = p.whats.slice(0, 4).map((w) => `${w.what.slice(0, 80)} ${duration(w.ms)}`);
    l.push(`- ${p.place} ${duration(p.ms)} (${whats.join('; ')})`);
  }
  l.push('In order (3 minutes or more):');
  for (const b of d.blocks.filter((x) => len(x) >= 180_000).slice(0, 60))
    l.push(`- ${clock(b.start)}–${clock(b.end)} ${b.place}${b.what ? `: ${b.what.slice(0, 80)}` : ''}`);
  return l.join('\n');
}
