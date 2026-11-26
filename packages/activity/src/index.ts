import type {
  ActivityCategory,
  ActivityDay,
  ActivityRules,
  ActivitySpan,
  DayBlock,
  DayDevice,
  DayPlace,
} from '@orvyn/contracts';

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

/** An Android package: "com.whatsapp" */
export const isPackage = (app: string) => /^[a-z][\w]*(\.[\w]+)+$/i.test(app) && !/\.exe$/i.test(app);

function describeApp(app: string, title: string): { place: string; what: string } {
  // a phone app: its own name, as the phone gave it
  if (isPackage(app)) return { place: PHONE_APPS[app]?.[0] ?? (title || app), what: '' };
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

/** Android apps people use most: a name where the phone gives none, and what they count as. */
export const PHONE_APPS: Record<string, [string, ActivityCategory]> = {
  'com.whatsapp': ['WhatsApp', 'messages'],
  'com.whatsapp.w4b': ['WhatsApp Business', 'messages'],
  'org.telegram.messenger': ['Telegram', 'messages'],
  'com.google.android.apps.messaging': ['Messages', 'messages'],
  'com.slack': ['Slack', 'messages'],
  'com.discord': ['Discord', 'messages'],
  'com.google.android.gm': ['Gmail', 'mail'],
  'com.microsoft.office.outlook': ['Outlook', 'mail'],
  'com.zoho.mail': ['Zoho Mail', 'mail'],
  'com.google.android.youtube': ['YouTube', 'video'],
  'com.netflix.mediaclient': ['Netflix', 'video'],
  'in.startv.hotstar': ['Hotstar', 'video'],
  'com.jio.media.ondemand': ['JioCinema', 'video'],
  'com.amazon.avod.thirdpartyclient': ['Prime Video', 'video'],
  'com.spotify.music': ['Spotify', 'music'],
  'com.google.android.apps.youtube.music': ['YouTube Music', 'music'],
  'com.jio.media.jiobeats': ['JioSaavn', 'music'],
  'com.instagram.android': ['Instagram', 'social'],
  'com.facebook.katana': ['Facebook', 'social'],
  'com.twitter.android': ['X', 'social'],
  'com.reddit.frontpage': ['Reddit', 'social'],
  'com.snapchat.android': ['Snapchat', 'social'],
  'com.linkedin.android': ['LinkedIn', 'social'],
  'com.instagram.barcelona': ['Threads', 'social'],
  'com.android.chrome': ['Chrome', 'research'],
  'com.google.android.googlequicksearchbox': ['Google', 'research'],
  'com.openai.chatgpt': ['ChatGPT', 'ai'],
  'com.anthropic.claude': ['Claude', 'ai'],
  'com.google.android.apps.bard': ['Gemini', 'ai'],
  'com.github.android': ['GitHub', 'code'],
  'com.termux': ['Termux', 'code'],
  'com.google.android.calendar': ['Calendar', 'work'],
  'com.google.android.apps.docs': ['Drive', 'work'],
  'com.google.android.apps.docs.editors.docs': ['Google Docs', 'work'],
  'com.google.android.apps.docs.editors.sheets': ['Google Sheets', 'work'],
  'com.clickup.app': ['ClickUp', 'work'],
  'notion.id': ['Notion', 'work'],
  'us.zoom.videomeetings': ['Zoom', 'meeting'],
  'com.google.android.apps.tachyon': ['Meet', 'meeting'],
  'com.microsoft.teams': ['Teams', 'meeting'],
  'com.naukri.app': ['Naukri', 'jobs'],
  'com.phonepe.app': ['PhonePe', 'money'],
  'com.google.android.apps.nbu.paisa.user': ['Google Pay', 'money'],
  'net.one97.paytm': ['Paytm', 'money'],
  'com.zerodha.kite3': ['Kite', 'money'],
  'com.nextbillion.groww': ['Groww', 'money'],
  'com.snapwork.hdfc': ['HDFC Bank', 'money'],
  'com.csam.icici.bank.imobile': ['iMobile', 'money'],
  'com.sbi.lotusintouch': ['YONO SBI', 'money'],
  'in.amazon.mShop.android.shopping': ['Amazon', 'shopping'],
  'com.flipkart.android': ['Flipkart', 'shopping'],
  'com.myntra.android': ['Myntra', 'shopping'],
  'com.application.zomato': ['Zomato', 'shopping'],
  'in.swiggy.android': ['Swiggy', 'shopping'],
  'com.grofers.customerapp': ['Blinkit', 'shopping'],
  'com.duolingo': ['Duolingo', 'learning'],
  'com.coursera.app': ['Coursera', 'learning'],
  'app.dubey.orvyn': ['ORVYN', 'work'],
  'com.google.android.apps.maps': ['Maps', 'other'],
  'com.google.android.dialer': ['Phone', 'messages'],
  'com.android.dialer': ['Phone', 'messages'],
  'com.google.android.GoogleCamera': ['Camera', 'other'],
  'com.google.android.apps.photos': ['Photos', 'other'],
  'com.android.settings': ['Settings', 'system'],
};

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
    host ? inside(host, k) : k.replace(/\.exe$/i, '').toLowerCase() === exe.toLowerCase() || k === s.app,
  );
  // the most exact rule wins
  if (own.length) return own.sort((a, b) => b[0].length - a[0].length)[0]![1];
  if (host) {
    if (SEARCH.test(host)) return 'research';
    if (host === 'linkedin.com' && s.path.startsWith('/jobs')) return 'jobs';
    return BY_HOST.find(([re]) => re.test(host))?.[1] ?? 'other';
  }
  if (isPackage(s.app)) {
    if (PHONE_APPS[s.app]) return PHONE_APPS[s.app]![1];
    if (/launcher|systemui|nexuslauncher/i.test(s.app)) return 'system';
    if (/game|games\./i.test(s.app)) return 'games';
    return 'other';
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
  const newest = (src: ActivitySpan['source']) => {
    let best: Piece | null = null;
    for (const p of open) if (p.s.source === src && (!best || p.from >= best.from)) best = p;
    return best?.s ?? null;
  };
  const pc = newest('pc');
  const web = newest('web');
  if (!pc && !web) return newest('phone');
  if (!pc) return web;
  if (pc.kind === 'locked') return pc;
  if (pc.kind === 'away') return web?.kind === 'media' ? web : pc;
  if (BROWSERS.test(pc.app) && web) return web.kind === 'away' ? pc : web;
  return pc;
}

/** A span with the device that sent it (the API adds it; spans without one are one device). */
export type DeviceSpan = ActivitySpan & { device?: string };
export interface DeviceName {
  id: string;
  name: string;
}
type Seat = { id: string; kind: DayDevice['kind']; with: string[]; spans: DeviceSpan[] };

const kindOf = (spans: DeviceSpan[]): DayDevice['kind'] =>
  spans.some((s) => s.source === 'pc') ? 'pc' : spans.some((s) => s.source === 'phone') ? 'phone' : 'web';
const overlap = (a: [number, number], b: [number, number]) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const range = (s: ActivitySpan): [number, number] => [Date.parse(s.start), Date.parse(s.end)];

/**
 * Who sat where. A browser goes with the PC it ran on: the one whose browser was in front, by the clock, for most of
 * the browser's time. Two PCs, a laptop and a phone at once stay apart.
 */
export function seats(spans: DeviceSpan[], from: number, to: number): Seat[] {
  const by = new Map<string, DeviceSpan[]>();
  for (const s of spans) {
    const k = s.device ?? '';
    by.set(k, [...(by.get(k) ?? []), s]);
  }
  const all: Seat[] = [...by].map(([id, list]) => ({ id, kind: kindOf(list), with: [], spans: list }));
  const pcs = all.filter((x) => x.kind === 'pc');
  const out = all.filter((x) => x.kind !== 'web');
  const clip = (r: [number, number]): [number, number] => [Math.max(r[0], from), Math.min(r[1], to)];
  for (const web of all.filter((x) => x.kind === 'web')) {
    const mine = web.spans.filter((s) => s.kind !== 'away').map((s) => clip(range(s)));
    const total = mine.reduce((a, r) => a + Math.max(0, r[1] - r[0]), 0);
    let best: { seat: Seat; ms: number } | null = null;
    for (const pc of pcs) {
      const fronts = pc.spans.filter((s) => BROWSERS.test(s.app) && s.kind === 'active').map(range);
      const ms = mine.reduce((a, r) => a + fronts.reduce((b, f) => b + overlap(r, f), 0), 0);
      if (!best || ms > best.ms) best = { seat: pc, ms };
    }
    if (best && total > 0 && best.ms >= total * 0.3) {
      best.seat.spans = [...best.seat.spans, ...web.spans];
      best.seat.with.push(web.id);
    } else out.push(web);
  }
  return out;
}

/** What has the attention when several devices are in use: a phone in hand, then use, then sound, then nobody. */
const weight = (s: ActivitySpan) =>
  s.kind === 'active' ? (s.source === 'phone' ? 4 : 3) : s.kind === 'media' ? 2 : 1;

function focus(lanes: Piece[][]): Piece[] {
  const pieces = lanes.flat().sort((x, y) => x.from - y.from);
  const cuts = [...new Set(pieces.flatMap((p) => [p.from, p.to]))].sort((x, y) => x - y);
  const out: Piece[] = [];
  let open: Piece[] = [];
  let i = 0;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const x = cuts[c]!;
    const y = cuts[c + 1]!;
    open = open.filter((p) => p.to > x);
    while (i < pieces.length && pieces[i]!.from <= x) open.push(pieces[i++]!);
    let best: Piece | null = null;
    for (const p of open)
      if (
        p.to > x &&
        (!best || weight(p.s) > weight(best.s) || (weight(p.s) === weight(best.s) && p.from > best.from))
      )
        best = p;
    if (!best) continue;
    const last = out.at(-1);
    if (last && last.s === best.s && last.to === x) last.to = y;
    else out.push({ from: x, to: y, s: best.s });
  }
  return out;
}

function toBlocks(
  pieces: Piece[],
  rules: Partial<ActivityRules> | undefined,
  name: (s: DeviceSpan) => string,
) {
  const blocks: DayBlock[] = [];
  for (const f of pieces) {
    const gone = f.s.kind === 'away' || f.s.kind === 'locked';
    const d = gone ? { place: f.s.kind === 'locked' ? 'Locked' : 'Away', what: '' } : describe(f.s);
    const whole = Math.max(1, Date.parse(f.s.end) - Date.parse(f.s.start));
    const n = (v: number) => Math.round((v * (f.to - f.from)) / whole);
    const device = name(f.s);
    const last = blocks.at(-1);
    if (
      last &&
      last.place === d.place &&
      last.what === d.what &&
      last.kind === f.s.kind &&
      last.device === device &&
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
      category: gone ? 'other' : categorize(f.s, rules),
      keys: n(f.s.keys),
      clicks: n(f.s.clicks),
      scrolls: n(f.s.scrolls),
      device,
    });
  }
  return blocks;
}

function placesOf(here: DayBlock[]): DayPlace[] {
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
  let prev = '';
  for (const b of here) {
    const d = len(b);
    const p = places.get(b.place) ?? {
      place: b.place,
      key: b.key,
      category: b.category,
      ms: 0,
      visits: 0,
      whats: new Map<string, number>(),
    };
    p.ms += d;
    if (prev !== b.place) p.visits++;
    prev = b.place;
    if (b.what) p.whats.set(b.what, (p.whats.get(b.what) ?? 0) + d);
    places.set(b.place, p);
  }
  return [...places.values()]
    .sort((a, b) => b.ms - a.ms)
    .map((p) => ({
      ...p,
      whats: [...p.whats]
        .map(([what, ms]) => ({ what, ms }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 8),
    }));
}

const using = (b: DayBlock) => b.kind === 'active' || b.kind === 'media';

export function buildDay(
  date: string,
  spans: DeviceSpan[],
  o: {
    from: number;
    to: number;
    hourOf(ms: number): number;
    rules?: Partial<ActivityRules>;
    devices?: DeviceName[];
  },
): ActivityDay {
  const names = new Map((o.devices ?? []).map((d) => [d.id, d.name]));
  const seated = seats(spans, o.from, o.to);
  const seatOf = new Map<string, Seat>();
  for (const st of seated) {
    seatOf.set(st.id, st);
    for (const w of st.with) seatOf.set(w, st);
  }
  const fallback = (k: DayDevice['kind']) => (k === 'pc' ? 'A PC' : k === 'phone' ? 'A phone' : 'A browser');
  const nameOf = (st: Seat) => names.get(st.id) ?? fallback(st.kind);
  const name = (s: DeviceSpan) => {
    const st = seatOf.get(s.device ?? '');
    return st ? nameOf(st) : '';
  };
  const lanes = seated.map((st) => flatten(st.spans, o.from, o.to));
  const devices: DayDevice[] = seated.map((st, k) => {
    const blocks = toBlocks(lanes[k]!, o.rules, name);
    const here = blocks.filter(using);
    return {
      id: st.id,
      name: nameOf(st),
      kind: st.kind,
      with: st.with.map((w) => names.get(w) ?? 'A browser'),
      activeMs: here.reduce((a, b) => a + len(b), 0),
      blocks,
      places: placesOf(here),
    };
  });
  const blocks = toBlocks(focus(lanes), o.rules, name);
  const here = blocks.filter(using);
  const cats = new Map<ActivityCategory, number>();
  const hours = new Array<number>(24).fill(0);
  let switches = 0;
  let prev = '';
  for (const b of here) {
    cats.set(b.category, (cats.get(b.category) ?? 0) + len(b));
    if (prev && prev !== b.place) switches++;
    prev = b.place;
    // spread over the hours it covers (time zones differ by quarter hours at most)
    for (let t = Date.parse(b.start); t < Date.parse(b.end);) {
      const next = Math.min(Date.parse(b.end), (Math.floor(t / 900_000) + 1) * 900_000);
      hours[o.hourOf(t)]! += next - t;
      t = next;
    }
  }
  const deep = deepRuns(here);
  const sum = (k: 'keys' | 'clicks' | 'scrolls') =>
    devices.reduce((a, d) => a + d.blocks.filter(using).reduce((x, b) => x + b[k], 0), 0);
  return {
    date,
    firstAt: here[0]?.start ?? null,
    lastAt: here.at(-1)?.end ?? null,
    activeMs: here.reduce((a, b) => a + len(b), 0),
    awayMs: blocks.reduce((a, b) => a + (b.kind === 'away' || b.kind === 'locked' ? len(b) : 0), 0),
    devices: devices.sort((a, b) => b.activeMs - a.activeMs),
    byCategory: [...cats].map(([category, ms]) => ({ category, ms })).sort((a, b) => b.ms - a.ms),
    places: placesOf(here),
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
      `On a device from ${clock(d.firstAt)} to ${clock(d.lastAt)}: ${duration(d.activeMs)} in use, ${duration(d.awayMs)} away.`,
    );
  for (const v of d.devices)
    l.push(
      `- ${v.kind === 'phone' ? 'Phone' : v.kind === 'pc' ? 'PC' : 'Browser'} "${v.name}": ${duration(v.activeMs)}`,
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
    l.push(
      `- ${clock(b.start)}–${clock(b.end)} ${b.place}${b.what ? `: ${b.what.slice(0, 80)}` : ''}${d.devices.length > 1 ? ` (${b.device})` : ''}`,
    );
  return l.join('\n');
}
