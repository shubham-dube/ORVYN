/// <reference types="chrome" />
import {
  type ActivityDay,
  type ActivityRules,
  type ActivitySpan,
  type FillField,
  type FillMapReply,
  FillMapRequest,
  type FillProfile,
  Hlc,
  type Mutation,
  type MissedNotifications,
  type NotificationView,
  type PageReadReply,
  type ServerMessage,
} from '@orvyn/contracts';
import { bareHost, inside } from '@orvyn/activity';
import { occurredAtFor, parseSpend } from '@orvyn/money';
import type { VaultKeys } from '@orvyn/vault-crypto';
import { API_URL, VERSION, WEB_URL } from './config';
import {
  type Answer,
  badgeText,
  captureMutations,
  Client,
  codeFromCallback,
  connectUrl,
  type DataRequest,
  DEFAULT_PREFS,
  type FillReport,
  type FocusState,
  type FoundDoc,
  type Glance,
  type MoneyGlance,
  notificationButtons,
  type PageView,
  pkce,
  type Prefs,
  type Request,
  type Stash,
  type Status,
  type Store,
  type TodayGlance,
  unreadCount,
} from './core';
import { applyMap, plan } from './match';
import type { PageApi } from './page/content';
import { type Found, keepable, priceLine, Recall } from './recall';
import { rewind, step, type TrackState } from './tracker';
import { Vault, vaultMutation } from './vault';

const store: Store = {
  get: async (k) => (await chrome.storage.local.get(k))[k] as string | undefined,
  set: async (k, v) =>
    v === undefined ? chrome.storage.local.remove(k) : chrome.storage.local.set({ [k]: v }),
};
const local = {
  get: async <T>(k: string): Promise<T | undefined> =>
    (await chrome.storage.local.get(k))[k] as T | undefined,
  set: (k: string, v: unknown) => chrome.storage.local.set({ [k]: v }),
};
const session = {
  get: async (k: string) => (await chrome.storage.session.get(k))[k] as unknown,
  set: (k: string, v: unknown) => chrome.storage.session.set({ [k]: v }),
  remove: (k: string) => chrome.storage.session.remove(k),
};
/** One thing at a time per name, so two events can't overwrite each other's state. */
const chains = new Map<string, Promise<unknown>>();
function serial<T>(name: string, f: () => Promise<T>): Promise<T> {
  const p = (chains.get(name) ?? Promise.resolve()).then(f, f);
  chains.set(
    name,
    p.catch(() => undefined),
  );
  return p;
}

const client = new Client(API_URL, store);
const recall = new Recall();
const clock = new Hlc(`x${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
const prefs = async (): Promise<Prefs> => ({
  ...DEFAULT_PREFS,
  ...(await local.get<Partial<Prefs>>('prefs')),
});
const can = async (k: string): Promise<boolean> => {
  const me = await client.me();
  return me?.role === 'owner' || !!me?.entitlements.includes(k as never);
};
const vault = new Vault({
  box: () =>
    client.call<{ keys: VaultKeys | null; items: { id: string; blob: string }[] }>('GET', '/vault/box'),
  save: async (id, blob) => {
    const r = await client.call<{ rejected: { reason: string }[] }>('POST', '/sync/push', {
      mutations: [vaultMutation(id, blob, clock.tick(), crypto.randomUUID())],
    });
    if (r.rejected.length) throw new Error(r.rejected[0]!.reason);
  },
  session,
  autoLockMin: async () => (await prefs()).autoLockMin,
  now: Date.now,
});

let notifications: NotificationView[] = [];
let ws: WebSocket | null = null;
let live = false;
let keepAlive: ReturnType<typeof setInterval> | undefined;

client.onSignedOut = () => {
  closeSocket();
  notifications = [];
  void vault.wipe();
  void chrome.storage.local.remove([
    'shownNotifications',
    'notificationsSince',
    'queue',
    'spans',
    'profile',
    'rules',
    'stashes',
    'fillMaps',
  ]);
  void chrome.storage.session.clear();
  void render();
};

// ------------------------------------------------------------------ connect / live

async function connect(): Promise<void> {
  const { verifier, challenge, state } = await pkce();
  const redirect = chrome.identity.getRedirectURL('connected');
  const back = await chrome.identity.launchWebAuthFlow({
    url: connectUrl(WEB_URL, redirect, challenge, state),
    interactive: true,
  });
  if (!back) throw new Error('cancelled');
  const code = codeFromCallback(back, state);
  const name = navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome';
  const me = await client.redeem(code, verifier, `ORVYN for ${name}`, VERSION);
  // what one person read is never shown to another; signing in again keeps mine
  if ((await local.get<string>('recallOwner')) !== me.id) {
    await recall.clear();
    await local.set('recallOwner', me.id);
  }
  await startLive();
}

async function startLive(): Promise<void> {
  if (!(await client.isConnected())) return;
  try {
    notifications = (await client.call<{ items: NotificationView[] }>('GET', '/notifications?limit=20'))
      .items;
  } catch {
    // offline: keep what we had
  }
  await render();
  openSocket();
}

function openSocket(): void {
  if (ws || !client.accessToken) return;
  const socket = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws`);
  ws = socket;
  socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: client.accessToken }));
  socket.onmessage = (e) => void onMessage(JSON.parse(String(e.data)) as ServerMessage);
  socket.onclose = async (e) => {
    if (ws !== socket) return;
    ws = null;
    live = false;
    clearInterval(keepAlive);
    if (e.code === 4401 && !(await client.refresh())) return; // signed out elsewhere: onSignedOut cleans up
    // reconnect is driven by the alarm (service workers may sleep in between)
  };
  // Chrome keeps a service worker alive while its socket is active; the server ignores these after auth
  keepAlive = setInterval(
    () => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'),
    20_000,
  );
}

function closeSocket(): void {
  const s = ws;
  ws = null;
  live = false;
  clearInterval(keepAlive);
  s?.close();
}

/** Once for each time it speaks, whether it comes live or is caught up on. */
async function pop(n: NotificationView): Promise<void> {
  const key = `${n.id}:${n.updatedAt ?? ''}`;
  const shown = (await local.get<string[]>('shownNotifications')) ?? [];
  if (shown.includes(key)) return;
  await local.set('shownNotifications', [...shown, key].slice(-300));
  // an id that is already on screen would only change quietly
  await chrome.notifications.clear(n.id);
  chrome.notifications.create(n.id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: n.title,
    message: n.body || ' ',
    priority: n.priority === 'urgent' ? 2 : 0,
    requireInteraction: n.alarm || n.priority === 'urgent',
    buttons: notificationButtons(n).map((b) => ({ title: b.title })),
  });
}

/** What came or went while this browser was closed or its worker slept. */
async function catchUp(): Promise<void> {
  const since = await local.get<string>('notificationsSince');
  try {
    const m = await client.call<MissedNotifications>(
      'GET',
      `/notifications/missed${since ? `?since=${encodeURIComponent(since)}` : ''}`,
    );
    await local.set('notificationsSince', m.until);
    for (const id of m.cleared) chrome.notifications.clear(id);
    notifications = notifications.filter((n) => !m.cleared.includes(n.id));
    const more = m.items.length - 5;
    for (const n of m.items.slice(-5)) await pop(n);
    if (more > 0) tell(`${more} more while you were away`, 'Open ORVYN to see them.', 'missed');
  } catch {
    // asked again from the same moment next time
  }
}

async function onMessage(m: ServerMessage): Promise<void> {
  switch (m.type) {
    case 'hello':
      live = true;
      await catchUp();
      break;
    case 'notify.new':
      // the same one may speak again (a second chat message, a reminder that repeats)
      notifications = [m.notification, ...notifications.filter((n) => n.id !== m.notification.id)].slice(
        0,
        50,
      );
      if (!m.notification.silent) await pop(m.notification); // silent: in the inbox only
      break;
    case 'notify.read':
      notifications = notifications.map((n) =>
        n.id === m.id ? { ...n, readAt: new Date().toISOString() } : n,
      );
      chrome.notifications.clear(m.id);
      break;
    case 'notify.dismissed':
      notifications = notifications.filter((n) => n.id !== m.id);
      chrome.notifications.clear(m.id);
      break;
    case 'session.revoked':
      await client.forget();
      break;
    default:
      break;
  }
  await render();
}

async function dismiss(id: string): Promise<void> {
  notifications = notifications.filter((n) => n.id !== id);
  chrome.notifications.clear(id);
  await render();
  await client.call('POST', `/notifications/${id}/dismiss`);
}

/** One of the notification's own buttons (Done, Snooze 10 min, …): the server does it and clears it everywhere. */
async function act(id: string, action: string): Promise<void> {
  notifications = notifications.filter((n) => n.id !== id);
  chrome.notifications.clear(id);
  await render();
  await client.call('POST', `/notifications/${id}/actions/${encodeURIComponent(action)}`);
}

async function open(id: string): Promise<void> {
  const n = notifications.find((x) => x.id === id);
  await chrome.tabs.create({ url: new URL(n?.url ?? '/', WEB_URL).toString() });
  chrome.notifications.clear(id);
  await client.call('POST', `/notifications/${id}/read`).catch(() => undefined);
}

async function render(): Promise<void> {
  const n = unreadCount(notifications);
  const pending = await vault.pending();
  await chrome.action.setBadgeText({ text: pending ? '+' : badgeText(n) });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a56c4' });
  await chrome.action.setTitle({
    title: pending ? `ORVYN — save the login for ${pending.host}?` : n ? `ORVYN — ${n} new` : 'ORVYN',
  });
}

async function status(error?: string, saved?: string): Promise<Status> {
  return { connected: await client.isConnected(), me: await client.me(), live, notifications, error, saved };
}

/** A small word from ORVYN that goes away by itself (clicking it opens `url`). */
function tell(title: string, message: string, id = `say:${crypto.randomUUID()}`): void {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message: message || ' ',
  });
  if (id.startsWith('say:')) setTimeout(() => chrome.notifications.clear(id), 6000);
}

// ------------------------------------------------------------------ saving things, online or not

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** fetch's own failure, not a mistake of ours that is also a TypeError */
const isOffline = (e: unknown): boolean =>
  e instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(e.message);
const NOT_SAVED = { feature_not_enabled: 'Not enabled for you' } as Record<string, string>;

/** Sent now, or kept and sent later. Every mutation has its own id, so arriving twice changes nothing. */
async function save(mutations: Mutation[]): Promise<'sent' | 'kept'> {
  try {
    const r = await client.call<{ rejected: { reason: string }[] }>('POST', '/sync/push', { mutations });
    if (r.rejected.length) throw new Error(NOT_SAVED[r.rejected[0]!.reason] ?? 'Not saved');
    return 'sent';
  } catch (e) {
    if (!isOffline(e)) throw e;
    await serial('queue', async () => {
      const q = (await local.get<Mutation[]>('queue')) ?? [];
      await local.set('queue', [...q, ...mutations].slice(-500));
    });
    return 'kept';
  }
}

function flushQueue(): Promise<void> {
  return serial('queue', async () => {
    const q = (await local.get<Mutation[]>('queue')) ?? [];
    if (!q.length || !(await client.isConnected())) return;
    try {
      await client.call('POST', '/sync/push', { mutations: q });
      await local.set('queue', []);
    } catch (e) {
      // refused for good (bad data, feature off): dropping it beats retrying forever
      if (!isOffline(e) && (e as { status?: number }).status === 400) await local.set('queue', []);
    }
  });
}

/** To Today (read by the same parser as everywhere, AI only for what it can't read) or to Drop. */
async function capture(target: 'today' | 'drop', text: string, link?: string): Promise<string> {
  if (!text.trim()) throw new Error('Type something first');
  let parsed: Parameters<typeof captureMutations>[2] = null;
  if (target === 'today')
    try {
      parsed = await client.call('POST', '/today/parse', { text, ai: true });
    } catch (e) {
      if (!isOffline(e)) throw e; // offline: it goes in as written, for today
    }
  const mutations = captureMutations(target, text, parsed, {
    stamp: () => clock.tick(),
    id: () => crypto.randomUUID(),
    today: localDay(),
  });
  if (link) {
    const task = mutations.find((m) => m.entity === 'today.task');
    if (task) task.fields = { ...task.fields, notes: link };
  }
  const how = await save(mutations);
  const later = how === 'kept' ? ' (it will be sent when you are online)' : '';
  return target === 'today'
    ? `Added to Today: ${parsed?.title ?? text}${later}`
    : how === 'kept'
      ? `Dropped${later}`
      : 'Dropped — a suggestion is on its way';
}

async function dropItem(fields: Record<string, unknown>): Promise<string> {
  const how = await save([
    {
      mutationId: crypto.randomUUID(),
      entity: 'drop.item',
      entityId: crypto.randomUUID(),
      op: 'upsert',
      fields: { source: 'extension', status: 'new', ...fields },
      hlc: clock.tick(),
    },
  ]);
  return how === 'kept' ? 'Kept; it will be sent when you are online' : 'In Drop';
}

/** A typed expense ("spent 240 on lunch"), read by the same rules as everywhere; filed under its category. */
async function expense(text: string): Promise<string> {
  const now = new Date();
  const s = parseSpend(text, { now });
  if (!s) throw new Error('Type an amount, like “spent 240 on lunch”');
  const g = await client.call<MoneyGlance>('GET', '/money/glance').catch((e) => {
    if (isOffline(e)) return null;
    throw e;
  });
  const cat = g?.categories.find((c) => c.slug && c.slug === s.category);
  await save([
    {
      mutationId: crypto.randomUUID(),
      entity: 'money.transaction',
      entityId: crypto.randomUUID(),
      op: 'upsert',
      fields: {
        amountMinor: s.amountMinor,
        direction: s.direction,
        merchant: s.merchant,
        note: s.note,
        categoryId: cat?.id ?? null,
        occurredAt: occurredAtFor(
          { date: s.date, time: s.time },
          now,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ).toISOString(),
        source: 'manual',
      },
      hlc: clock.tick(),
    },
  ]);
  return `${s.direction === 'credit' ? 'Received' : 'Spent'} ₹${(s.amountMinor / 100).toLocaleString('en-IN')}${cat ? ` · ${cat.name}` : ''}`;
}

async function complete(id: string): Promise<void> {
  await save([
    {
      mutationId: crypto.randomUUID(),
      entity: 'today.task',
      entityId: id,
      op: 'upsert',
      fields: { completedAt: new Date().toISOString() },
      hlc: clock.tick(),
    },
  ]);
}

/** Each part answers for itself; a part the person doesn't have (403) is simply absent. */
async function glance(): Promise<Glance> {
  const get = <T>(path: string) => client.call<T>('GET', path).catch(() => null);
  const [today, money] = await Promise.all([
    get<TodayGlance>('/today/glance'),
    get<MoneyGlance>('/money/glance'),
  ]);
  return { today, money };
}

// ------------------------------------------------------------------ the page in front

async function activeTab(): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t?.id || !t.url || !/^https?:/.test(t.url)) throw new Error('Not a web page');
  return t as chrome.tabs.Tab & { id: number; url: string };
}

/** Calls the page's isolated half. Page scripts can neither see nor answer this. */
async function inPage<K extends keyof PageApi>(
  tabId: number,
  name: K,
  args: Parameters<PageApi[K]>,
  frameIds?: number[],
): Promise<{ frameId: number; result: Awaited<ReturnType<PageApi[K]>> }[]> {
  const run = () =>
    chrome.scripting.executeScript({
      target: { tabId, ...(frameIds ? { frameIds } : { allFrames: true }) },
      func: (k: string, a: unknown[]) => {
        const api = (globalThis as unknown as { __orvyn?: Record<string, (...x: unknown[]) => unknown> })
          .__orvyn;
        return api?.[k] ? { value: api[k](...a) } : null;
      },
      args: [name, args as unknown[]],
    });
  let r = await run();
  if (r.every((x) => !x.result)) {
    // a page opened before ORVYN was installed or updated
    await chrome.scripting.executeScript({ target: { tabId, allFrames: !frameIds }, files: ['content.js'] });
    r = await run();
  }
  return r.flatMap((x) =>
    x.result
      ? [{ frameId: x.frameId, result: (x.result as { value: Awaited<ReturnType<PageApi[K]>> }).value }]
      : [],
  );
}

async function pageView(): Promise<PageView> {
  const tab = await activeTab();
  const t = (await inPage(tab.id, 'text', [], [0]))[0]?.result;
  const mem = await recall.get(tab.url).catch(() => undefined);
  return {
    url: tab.url,
    title: tab.title ?? '',
    host: new URL(tab.url).hostname,
    selection: t?.selection ?? '',
    forms: t?.forms ?? 0,
    memory: mem
      ? {
          firstAt: mem.firstAt,
          lastAt: mem.lastAt,
          visits: mem.visits,
          dwellMs: mem.dwellMs,
          notes: mem.notes,
          price: priceLine(mem.prices),
        }
      : null,
    focus: await focusState(),
  };
}

async function think(
  mode: 'brief' | 'ask' | 'catch' | 'actions' | 'compare',
  question = '',
): Promise<PageReadReply> {
  const tab = await activeTab();
  const tabs =
    mode === 'compare'
      ? (await chrome.tabs.query({ highlighted: true, lastFocusedWindow: true })).length > 1
        ? await chrome.tabs.query({ highlighted: true, lastFocusedWindow: true })
        : await chrome.tabs.query({ lastFocusedWindow: true })
      : [tab];
  const pages: { url: string; title: string; text: string }[] = [];
  for (const t of tabs) {
    if (!t.id || !t.url || !/^https?:/.test(t.url) || pages.length >= 6) continue;
    const r = (await inPage(t.id, 'text', [], [0]).catch(() => []))[0]?.result;
    // a page with a password box or a bank is never sent, whatever is asked
    if (!r || !keepable(t.url, r.hasPassword) || t.url.startsWith(`${WEB_URL}/vault`)) continue;
    pages.push({
      url: t.url.split(/[?#]/)[0]!.slice(0, 2000),
      title: r.title.slice(0, 300),
      text: r.selection || r.text,
    });
  }
  if (!pages.length)
    throw new Error('This page is private (a sign-in, a bank or a local page), so it is not read');
  const cap = mode === 'compare' ? 7000 : 24_000;
  return client.call('POST', '/page/read', {
    mode,
    question,
    pages: pages.map((p) => ({ ...p, text: p.text.slice(0, cap) })),
  });
}

async function screenshot(): Promise<string> {
  const tab = await activeTab();
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const id = await client.upload(
    await (await fetch(url)).blob(),
    `${new URL(tab.url).hostname} ${localDay()}.png`,
  );
  return dropItem({
    kind: 'photo',
    fileId: id,
    fileName: `${new URL(tab.url).hostname}.png`,
    text: `${tab.title ?? ''}\n${tab.url}`.slice(0, 2000),
  });
}

async function readLater(): Promise<string> {
  const tab = await activeTab();
  const t = (await inPage(tab.id, 'text', [], [0]))[0]?.result;
  if (!t) throw new Error('This page cannot be read');
  // "kept" = already decided to be a note, so no AI is spent on guessing what it is
  return dropItem({
    kind: 'link',
    url: tab.url.slice(0, 2000),
    text: `${t.title}\n\n${t.text}`.slice(0, 20_000),
    status: 'kept',
  });
}

// ------------------------------------------------------------------ magic fill

/** Frames that may be filled: the page itself, its own site's frames, and known form services it embeds. */
const FORM_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|typeform\.com|tally\.so|jotform\.com|docs\.google\.com|forms\.office\.com|hsforms\.com|bamboohr\.com|recruitee\.com|icims\.com|taleo\.net|zohorecruit\.(in|com)|keka\.com|darwinbox\.in)$/;
async function fillFrames(tab: { id: number; url: string }): Promise<number[]> {
  const host = new URL(tab.url).hostname;
  const site = host.split('.').slice(-2).join('.');
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab.id })) ?? [];
  return frames
    .filter((f) => {
      if (f.frameId === 0) return true;
      try {
        const u = new URL(f.url);
        return (
          u.protocol === 'https:' &&
          (u.hostname === host || inside(u.hostname, host) || FORM_HOSTS.test(u.hostname)) &&
          site !== ''
        );
      } catch {
        return false;
      }
    })
    .map((f) => f.frameId);
}

async function profile(): Promise<FillProfile> {
  try {
    const p = await client.call<FillProfile>('GET', '/fill/profile');
    await local.set('profile', p);
    return p;
  } catch (e) {
    const kept = await local.get<FillProfile>('profile');
    if (isOffline(e) && kept) return kept;
    throw e;
  }
}

async function scanAll(tab: { id: number; url: string }) {
  const frames = await fillFrames(tab);
  const r = await inPage(tab.id, 'scan', [], frames);
  // ids are per frame; make them one space
  const fields: FillField[] = r.flatMap((f) =>
    f.result.fields.map((x) => ({ ...x, id: `${f.frameId}:${x.id}` })),
  );
  return { fields: fields.slice(0, 120), files: r.reduce((a, f) => a + f.result.files, 0) };
}

async function fill(): Promise<FillReport> {
  const tab = await activeTab();
  if (tab.url.startsWith('http:') && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(tab.url))
    throw new Error('This page is not secure (http), so it is not filled');
  const p = await profile();
  if (!p.facts.length && !p.answers.length) throw new Error('Add your profile first');
  const host = new URL(tab.url).hostname;
  const { fields, files } = await scanAll(tab);
  if (!fields.length) throw new Error('No form found on this page');
  const { matches, unknown } = plan(fields, p, host);
  let aiProblem: string | null = null;
  const choosable = unknown.filter((u) => u.type !== 'textarea');
  if (choosable.length && p.facts.length) {
    const sig = JSON.stringify(choosable.map((u) => [u.label, u.type, u.options.length]));
    const keys = p.facts.map((f) => ({ key: f.key, label: f.label }));
    const cacheKey = `${host}|${await digest(sig + JSON.stringify(keys))}`;
    const maps = (await local.get<Record<string, FillMapReply['map']>>('fillMaps')) ?? {};
    // the same form again costs nothing; labels, not ids, are what stays the same
    const kept = maps[cacheKey];
    let map: { id: string; key: string | null }[] = kept
      ? kept.map((m) => ({ id: choosable[Number(m.id)]?.id ?? '', key: m.key }))
      : [];
    if (!kept)
      try {
        const req = FillMapRequest.parse({ fields: choosable, keys });
        map = (await client.call<FillMapReply>('POST', '/fill/map', req)).map;
        const byIndex = map.flatMap((m) => {
          const i = choosable.findIndex((c) => c.id === m.id);
          return i < 0 ? [] : [{ id: String(i), key: m.key }];
        });
        await local.set(
          'fillMaps',
          Object.fromEntries([...Object.entries(maps), [cacheKey, byIndex]].slice(-200)),
        );
      } catch (e) {
        aiProblem = e instanceof Error ? e.message : 'AI failed';
      }
    matches.push(...applyMap(map, choosable, p));
  }
  const done = new Set<string>();
  const byFrame = new Map<number, { id: string; value: string }[]>();
  for (const m of matches) {
    const [frame, id] = m.id.split(':') as [string, string];
    byFrame.set(Number(frame), [...(byFrame.get(Number(frame)) ?? []), { id, value: m.value }]);
  }
  // the tab may have moved on while the AI was thinking
  const still = await chrome.tabs.get(tab.id);
  if (!still.url || new URL(still.url).origin !== new URL(tab.url).origin)
    throw new Error('The page changed; try again');
  for (const [frame, values] of byFrame) {
    const r = (await inPage(tab.id, 'fill', [values], [frame]))[0]?.result;
    r?.done.forEach((id) => done.add(`${frame}:${id}`));
  }
  const label = new Map(fields.map((f) => [f.id, f.label || f.name]));
  return {
    filled: matches
      .filter((m) => done.has(m.id))
      .map((m) => ({ label: label.get(m.id) ?? '', value: m.value.slice(0, 80), from: m.from })),
    left: fields
      .filter((f) => !matches.some((m) => m.id === f.id) && f.label)
      .map((f) => ({ label: f.label, long: f.type === 'textarea' })),
    files,
    aiProblem,
  };
}

async function undoFill(): Promise<number> {
  const tab = await activeTab();
  return (await inPage(tab.id, 'undo', [], await fillFrames(tab))).reduce((a, r) => a + r.result, 0);
}

/** Remembers what I answered here: facts stay facts; everything else becomes an answer to that question. */
async function learn(): Promise<number> {
  const tab = await activeTab();
  const host = new URL(tab.url).hostname;
  const p = await profile();
  const r = await inPage(tab.id, 'answers', [], await fillFrames(tab));
  let n = 0;
  const answers = [...p.answers];
  for (const { q, a, field } of r.flatMap((x) => x.result)) {
    const already = plan([field], p, host).matches[0];
    if (already && already.value.trim().toLowerCase() === a.trim().toLowerCase()) continue;
    const i = answers.findIndex((x) => x.q.toLowerCase() === q.toLowerCase() && x.host === host);
    if (i >= 0) answers.splice(i, 1);
    answers.push({ q: q.slice(0, 500), a: a.slice(0, 5000), host });
    n++;
  }
  if (n) {
    const next = { ...p, answers: answers.slice(-1000) };
    await client.call('PUT', '/fill/profile', next);
    await local.set('profile', next);
  }
  return n;
}

async function digest(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

// ------------------------------------------------------------------ the Vault and pages

async function fillLogin(id: string): Promise<string> {
  const tab = await activeTab();
  const login = await vault.forPage(id, tab.url);
  const [r] = await inPage(tab.id, 'fillLogin', [login], [0]);
  if (r?.result === 'done') return 'Filled. Check it, then sign in.';
  throw new Error(r?.result === 'moved' ? 'The page changed; try again' : 'No sign-in box on this page');
}

async function newPassword(): Promise<string> {
  const tab = await activeTab();
  const password = vault.generate();
  const [r] = await inPage(tab.id, 'fillNew', [{ host: new URL(tab.url).hostname, password }], [0]);
  if (r?.result !== 'done') throw new Error('No empty password box on this page');
  return 'A strong password is in. ORVYN asks to save it when you continue.';
}

async function onLogin(tab: chrome.tabs.Tab, url: string, username: string, password: string): Promise<void> {
  if (!(await can('vault')) || !(await client.isConnected()) || !(await prefs()).offerSave) return;
  // never the Vault passphrase typed into ORVYN itself
  if (new URL(url).origin === new URL(WEB_URL).origin) return;
  if (!(await vault.seen(url, username, password))) return;
  await render();
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    tell(
      'Save this login?',
      `${new URL(url).hostname}${username ? ` · ${username}` : ''}. Click ORVYN’s icon.`,
      'vault:pending',
    );
  }
}

// ------------------------------------------------------------------ My Day

const appName = navigator.userAgent.includes('Edg/') ? 'msedge' : 'chrome';

/** What is in front right now, from Chrome itself (never from what a page says). */
async function front(): Promise<{ url: string; title: string; tabId: number } | null> {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  if (!w?.focused) return null;
  const [t] = await chrome.tabs.query({ active: true, windowId: w.id });
  return t?.id !== undefined && t.url ? { url: t.url, title: t.title ?? '', tabId: t.id } : null;
}

function track(
  counts: { keys?: number; clicks?: number; scrolls?: number } = {},
  playing?: boolean,
): Promise<void> {
  return serial('track', async () => {
    if (!(await prefs()).track || !(await can('activity')) || !(await client.isConnected())) return;
    const idle = await chrome.idle.queryState(60);
    const f = await front();
    const t = Date.now();
    let s = ((await session.get('track')) as TrackState | undefined) ?? { open: null };
    if (playing !== undefined && f) await session.set('playing', { tabId: f.tabId, t, playing });
    const p = (await session.get('playing')) as { tabId: number; t: number; playing: boolean } | undefined;
    const media = !!p?.playing && p.tabId === f?.tabId && t - p.t < 40_000;
    const kind = idle === 'active' ? 'active' : idle === 'idle' && media ? 'media' : 'away';
    if (kind === 'away' && s.open && s.open.kind !== 'away') s = rewind(s, t, 60_000);
    const r = step(
      s,
      { t, url: f?.url ?? null, title: f?.title, kind, ...(kind === 'away' ? {} : counts) },
      { id: () => crypto.randomUUID(), app: appName },
    );
    await session.set('track', r.state);
    if (r.closed) {
      const list = (await local.get<ActivitySpan[]>('spans')) ?? [];
      await local.set('spans', [...list, r.closed].slice(-6000));
    }
  });
}

function pushSpans(): Promise<void> {
  return serial('spans', async () => {
    if (!(await client.isConnected()) || !(await can('activity'))) return;
    for (;;) {
      const list = (await local.get<ActivitySpan[]>('spans')) ?? [];
      const open = ((await session.get('track')) as TrackState | undefined)?.open;
      const batch = list.slice(0, 250);
      const all = open && Date.parse(open.end) > Date.parse(open.start) ? [...batch, open] : batch;
      if (!all.length) return;
      try {
        await client.call('POST', '/activity/spans', { spans: all });
      } catch (e) {
        // refused as malformed: one bad batch must not block the rest for ever
        if ((e as { status?: number }).status !== 400) return;
      }
      const ids = new Set(batch.map((b) => b.id));
      await serial('track', async () => {
        const now = (await local.get<ActivitySpan[]>('spans')) ?? [];
        await local.set(
          'spans',
          now.filter((x) => !ids.has(x.id)),
        );
      });
      if (list.length <= 250) return;
    }
  });
}

// ------------------------------------------------------------------ focus

async function focusState(): Promise<FocusState | null> {
  const f = await local.get<FocusState | null>('focus');
  if (!f) return null;
  if (Date.now() < f.until) return f;
  await local.set('focus', null);
  const mins = Math.round((f.until - f.from) / 60_000);
  tell(
    'Focus done',
    `${mins} min${f.what ? ` on ${f.what}` : ''}${f.bypassed ? ` · ${f.bypassed} detours` : ' · no detours'}`,
  );
  return null;
}
async function rules(): Promise<ActivityRules> {
  const kept = await local.get<{ at: number; rules: ActivityRules }>('rules');
  if (kept && Date.now() - kept.at < 10 * 60_000) return kept.rules;
  try {
    const r = await client.call<ActivityRules>('GET', '/activity/rules');
    await local.set('rules', { at: Date.now(), rules: r });
    return r;
  } catch {
    return kept?.rules ?? { categories: {}, blocked: [] };
  }
}
const DISTRACTING = [
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'youtube.com',
  'netflix.com',
  'primevideo.com',
  'hotstar.com',
  '9gag.com',
  'snapchat.com',
  'threads.net',
  'pinterest.com',
  'twitch.tv',
];
async function shieldFor(url: string): Promise<{ what: string; minutes: number } | null> {
  const f = await focusState();
  if (!f) return null;
  const host = bareHost(new URL(url).hostname);
  if ((f.pass[host] ?? 0) > Date.now()) return null;
  const own = (await rules()).blocked;
  const list = own.length ? own : DISTRACTING;
  return list.some((b) => inside(host, b))
    ? { what: f.what, minutes: Math.max(1, Math.ceil((f.until - Date.now()) / 60_000)) }
    : null;
}
async function bypass(url: string): Promise<void> {
  const f = await focusState();
  if (!f) return;
  f.bypassed++;
  f.pass[bareHost(new URL(url).hostname)] = Date.now() + 5 * 60_000;
  await local.set('focus', f);
}

// ------------------------------------------------------------------ tab stash

async function stash(name: string, on: string | null): Promise<number> {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true, pinned: false });
  const keep = tabs.filter((t) => t.url && /^https?:/.test(t.url) && !t.audible);
  if (!keep.length) throw new Error('No tabs to put away');
  const s: Stash = {
    id: crypto.randomUUID(),
    name: name.trim() || `${keep.length} tabs`,
    at: Date.now(),
    on,
    tabs: keep.map((t) => ({ url: t.url!, title: t.title ?? t.url! })),
  };
  await local.set('stashes', [s, ...((await local.get<Stash[]>('stashes')) ?? [])].slice(0, 100));
  // saved first, then closed; the window stays open on a new tab
  if (keep.length === tabs.length) await chrome.tabs.create({});
  await chrome.tabs.remove(keep.map((t) => t.id!));
  return keep.length;
}
async function unstash(id: string, reopen: boolean): Promise<Stash[]> {
  const list = (await local.get<Stash[]>('stashes')) ?? [];
  const s = list.find((x) => x.id === id);
  if (s && reopen) await chrome.windows.create({ url: s.tabs.map((t) => t.url), focused: true });
  const next = list.filter((x) => x.id !== id);
  await local.set('stashes', next);
  return next;
}
/** Once, on its day: "you wanted these back today". */
async function dueStashes(): Promise<void> {
  const list = (await local.get<Stash[]>('stashes')) ?? [];
  const due = list.filter((s) => s.on && s.on <= localDay());
  if (!due.length) return;
  await local.set(
    'stashes',
    list.map((s) => (due.includes(s) ? { ...s, on: null } : s)),
  );
  for (const s of due)
    tell(`Tabs for today: ${s.name}`, `${s.tabs.length} tabs. Click to open.`, `stash:${s.id}`);
}

// ------------------------------------------------------------------ what the popup may ask

async function answer(req: DataRequest): Promise<unknown> {
  switch (req.type) {
    case 'glance':
      return glance();
    case 'search':
      return client.call<FoundDoc[]>('GET', `/library/search?q=${encodeURIComponent(req.q)}`).catch(() => []);
    case 'page':
      return pageView();
    case 'dropPage': {
      const t = await activeTab();
      return dropItem({ kind: 'link', url: t.url.slice(0, 2000), text: t.title ?? '' });
    }
    case 'readLater':
      return readLater();
    case 'screenshot':
      return screenshot();
    case 'note': {
      const t = await activeTab();
      await recall.note(t.url, t.title ?? '', req.text);
      return pageView();
    }
    case 'unnote': {
      const t = await activeTab();
      await recall.unnote(t.url, req.at);
      return pageView();
    }
    case 'forget':
      await recall.forget(req.url);
      return true;
    case 'think':
      return think(req.mode, req.question);
    case 'recall':
      return (await recall.search(req.q)) satisfies Found[];
    case 'fill':
      return fill();
    case 'undoFill':
      return undoFill();
    case 'learn':
      return learn();
    case 'draft': {
      const t = await activeTab();
      const text = (await inPage(t.id, 'text', [], [0]))[0]?.result.text ?? '';
      return client.call('POST', '/fill/draft', {
        question: req.question,
        page: text.slice(0, 6000),
        maxChars: req.maxChars ?? 900,
      });
    }
    case 'profile':
      return profile();
    case 'saveProfile': {
      const p = await client.call<FillProfile>('PUT', '/fill/profile', req.profile);
      await local.set('profile', p);
      return p;
    }
    case 'structure':
      return client.call('POST', '/fill/structure', { text: req.text });
    case 'vault': {
      const url = await activeTab().then(
        (t) => t.url,
        () => null,
      );
      if (!(await can('vault'))) return { state: 'off', logins: [], pending: null, autoLockMin: 15 };
      return vault.view(url);
    }
    case 'unlock':
      await vault.unlock(req.passphrase);
      return true;
    case 'lock':
      await vault.lock();
      return true;
    case 'fillLogin':
      return fillLogin(req.id);
    case 'totp':
      return vault.code(req.id);
    case 'newPassword':
      return newPassword();
    case 'savePending': {
      const said = await vault.savePending(req.username);
      await render();
      return said;
    }
    case 'dropPending':
      await vault.dismissPending();
      await render();
      return true;
    case 'day':
      await track();
      await pushSpans();
      return client.call<ActivityDay>(
        'GET',
        `/activity/day?date=${req.date}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      );
    case 'focus': {
      const f: FocusState = {
        what: req.what.slice(0, 120),
        from: Date.now(),
        until: Date.now() + Math.min(240, Math.max(1, req.minutes)) * 60_000,
        bypassed: 0,
        pass: {},
      };
      await local.set('focus', f);
      return f;
    }
    case 'unfocus':
      await local.set('focus', null);
      return null;
    case 'stash':
      return stash(req.name, req.on);
    case 'stashes':
      return (await local.get<Stash[]>('stashes')) ?? [];
    case 'unstash':
      return unstash(req.id, req.open);
    case 'prefs':
      return prefs();
    case 'setPrefs': {
      const next = { ...(await prefs()), ...req.prefs };
      await local.set('prefs', next);
      return next;
    }
    case 'jobos': {
      const base = new URL((await prefs()).jobos);
      if (base.hostname !== 'localhost' && base.hostname !== '127.0.0.1')
        throw new Error('JobOS must be on this PC');
      await chrome.tabs.create({ url: new URL('/jobs', base).toString() });
      return true;
    }
  }
}

// ------------------------------------------------------------------ wiring

const STATUS_TYPES = new Set<string>([
  'status',
  'connect',
  'disconnect',
  'dismiss',
  'act',
  'test',
  'quickAdd',
  'drop',
  'expense',
  'complete',
]);

interface PageMessage {
  type: string;
  keys?: number;
  clicks?: number;
  scrolls?: number;
  playing?: boolean;
  left?: boolean;
  title?: string;
  text?: string;
  dwellMs?: number;
  first?: boolean;
  hasPassword?: boolean;
  price?: { price: number; currency: string } | null;
  username?: string;
  password?: string;
}
const small = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(2000, Math.round(n))) : 0;

/** From a page: only these few things, and Chrome (not the page) says which page it is. */
async function fromPage(m: PageMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tab = sender.tab;
  const url = tab?.url;
  if (!tab?.id || !url || tab.incognito || !/^https?:/.test(url)) return null;
  switch (m.type) {
    case 'page.beat': {
      const f = await front();
      if (!m.left && f?.tabId !== tab.id) return null;
      await track(
        { keys: small(m.keys), clicks: small(m.clicks), scrolls: small(m.scrolls) },
        sender.frameId === 0 || m.playing ? !!m.playing : undefined,
      );
      return null;
    }
    case 'page.read': {
      const p = await prefs();
      const host = new URL(url).hostname;
      if (
        !p.recall ||
        sender.frameId !== 0 ||
        host === new URL(WEB_URL).hostname ||
        p.skipHosts.some((h) => inside(host, h))
      )
        return null;
      if (!(await client.isConnected()) || !keepable(url, !!m.hasPassword)) return null;
      // sender.url is the page that spoke; if the tab has moved on, this text is not that page's
      if (sender.url?.split('#')[0] !== url.split('#')[0] && !sameSite(sender.url, url)) return null;
      await recall.seen(url, {
        title: String(m.title ?? ''),
        text: String(m.text ?? ''),
        dwellMs: Math.max(0, Math.min(6 * 3_600_000, Number(m.dwellMs) || 0)),
        first: !!m.first,
        price:
          m.price && m.price.price > 0
            ? { price: Number(m.price.price), currency: String(m.price.currency).slice(0, 5) }
            : null,
      });
      return null;
    }
    case 'page.login':
      // the address is what Chrome says the top frame is
      if (sender.frameId === 0 && sender.url && typeof m.password === 'string')
        await onLogin(tab, sender.url, String(m.username ?? '').slice(0, 200), m.password.slice(0, 500));
      return null;
    case 'page.shield':
      return sender.frameId === 0 ? shieldFor(url) : null;
    case 'page.bypass':
      await bypass(url);
      return null;
    default:
      return null;
  }
}
const sameSite = (a: string | undefined, b: string) => {
  try {
    return !!a && new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

chrome.runtime.onMessage.addListener((req: DataRequest | Request | PageMessage, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  // our own pages (popup, side panel) and web pages are told apart by where they are, not by what they say
  const ours = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;
  if (!ours) {
    void fromPage(req as PageMessage, sender).then(reply, () => reply(null));
    return true;
  }
  if (STATUS_TYPES.has(req.type)) return onRequest(req as Request, reply);
  void answer(req as DataRequest).then(
    (ok) => reply({ ok } satisfies Answer<unknown>),
    (e) => reply({ error: e instanceof Error ? plain(e) : 'Something went wrong' } satisfies Answer<unknown>),
  );
  return true;
});
const plain = (e: Error) =>
  isOffline(e)
    ? 'You are offline'
    : e.message === 'wrong passphrase'
      ? 'That is not the passphrase'
      : /^http_403$|feature_not_enabled/.test(e.message)
        ? 'Not enabled for you'
        : e.message;

function onRequest(req: Request, reply: (s: Status) => void): boolean {
  const run = async (): Promise<Status> => {
    try {
      if (req.type === 'connect') await connect();
      if (req.type === 'disconnect') await client.signOut();
      if (req.type === 'dismiss') await dismiss(req.id);
      if (req.type === 'act') await act(req.id, req.action);
      if (req.type === 'test') await client.call('POST', '/notifications/test');
      if (req.type === 'status' && !ws) await startLive();
      if (req.type === 'quickAdd') return await status(undefined, await capture('today', req.text));
      if (req.type === 'drop') return await status(undefined, await capture('drop', req.text));
      if (req.type === 'expense') return await status(undefined, await expense(req.text));
      if (req.type === 'complete') await complete(req.id);
      return await status();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      return status(msg.includes('did not approve') || msg === 'cancelled' ? 'cancelled' : msg);
    }
  };
  void run().then(reply);
  return true; // async reply
}

chrome.notifications.onButtonClicked.addListener((id, button) => {
  const n = notifications.find((x) => x.id === id);
  if (!n) return;
  const b = notificationButtons(n)[button];
  if (!b) return;
  void (b.id === 'orvyn:open' ? open(id) : b.id === 'orvyn:dismiss' ? dismiss(id) : act(id, b.id));
});
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('stash:')) {
    chrome.notifications.clear(id);
    void unstash(id.slice(6), true);
  } else if (id === 'vault:pending') {
    chrome.notifications.clear(id);
    void chrome.action.openPopup().catch(() => undefined);
  } else if (!id.startsWith('say:')) void open(id);
});

async function menus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  const add = (
    id: string,
    title: string,
    contexts: [`${chrome.contextMenus.ContextType}`, ...`${chrome.contextMenus.ContextType}`[]],
  ) => chrome.contextMenus.create({ id, title, contexts });
  add('drop', 'Drop in ORVYN', ['selection', 'link', 'image', 'page']);
  add('today', 'Add to Today', ['selection', 'link', 'page']);
  add('note', 'Keep as a note on this page', ['selection']);
  add('fill', 'Fill this form', ['page', 'editable']);
}

async function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<string> {
  const page = tab?.url ?? info.pageUrl ?? '';
  const sel = info.selectionText?.trim();
  switch (info.menuItemId) {
    case 'drop':
      if (sel) return dropItem({ kind: 'text', text: `${sel}\n\n${page}`.slice(0, 20_000) });
      if (info.mediaType === 'image' && info.srcUrl) return dropImage(info.srcUrl, page);
      return dropItem({
        kind: 'link',
        url: (info.linkUrl ?? page).slice(0, 2000),
        text: info.linkUrl ? '' : (tab?.title ?? ''),
      });
    case 'today':
      return capture(
        'today',
        (sel || (info.linkUrl ?? tab?.title ?? page)).slice(0, 500),
        info.linkUrl ?? page,
      );
    case 'note':
      if (!page || !sel) throw new Error('Nothing selected');
      await recall.note(page, tab?.title ?? '', sel);
      return 'Noted on this page';
    case 'fill': {
      const r = await fill();
      return `${r.filled.length} filled, ${r.left.length} left for you`;
    }
    default:
      return '';
  }
}
async function dropImage(src: string, page: string): Promise<string> {
  const r = await fetch(src);
  const blob = await r.blob();
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(blob.type) || blob.size > 10_000_000)
    return dropItem({ kind: 'link', url: src.slice(0, 2000), text: page });
  const name = new URL(src, page).pathname.split('/').pop()?.slice(0, 80) || 'image';
  const id = await client.upload(blob, name);
  return dropItem({ kind: 'photo', fileId: id, fileName: name, text: page.slice(0, 2000) });
}
const said = (p: Promise<string>) =>
  void p.then(
    (s) => s && tell('ORVYN', s),
    (e) => tell('That did not work', e instanceof Error ? plain(e) : 'Try again'),
  );

chrome.contextMenus.onClicked.addListener((info, tab) => said(onMenu(info, tab)));
chrome.commands.onCommand.addListener((c) => {
  if (c === 'drop-page') said(answer({ type: 'dropPage' }) as Promise<string>);
  if (c === 'fill-page') said(fill().then((r) => `${r.filled.length} filled, ${r.left.length} left for you`));
});

chrome.omnibox.setDefaultSuggestion({
  description: 'Add to Today · “spent 240 lunch” · ?find in Library · !find a page I read',
});
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  if (text.startsWith('!') && text.length > 2)
    void recall
      .search(text.slice(1))
      .then((r) => suggest(r.slice(0, 6).map((p) => ({ content: p.url, description: esc(p.title) }))))
      .catch(() => undefined);
  if (text.startsWith('?') && text.length > 2)
    void client
      .call<FoundDoc[]>('GET', `/library/search?q=${encodeURIComponent(text.slice(1))}`)
      .then((r) =>
        suggest(
          r.slice(0, 6).map((d) => ({
            content: new URL(`/library?doc=${d.id}`, WEB_URL).toString(),
            description: esc(`${d.title} · ${d.category}`),
          })),
        ),
      )
      .catch(() => undefined);
});
chrome.omnibox.onInputEntered.addListener((text) => {
  const t = text.trim();
  if (/^https?:\/\//.test(t)) void chrome.tabs.update({ url: t });
  else if (t.startsWith('?'))
    void chrome.tabs.update({
      url: new URL(`/library?q=${encodeURIComponent(t.slice(1))}`, WEB_URL).toString(),
    });
  else if (t.startsWith('!'))
    void recall.search(t.slice(1)).then((r) => r[0] && chrome.tabs.update({ url: r[0].url }));
  else if (t)
    said(/₹|\brs\.?\s*\d|\bspent\b|\bpaid\b/i.test(t) && parseSpend(t) ? expense(t) : capture('today', t));
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(() => void track());
chrome.tabs.onActivated.addListener(() => void track());
chrome.tabs.onUpdated.addListener(
  (_id, info, tab) => void ((info.url || info.title) && tab.active && track()),
);
chrome.windows.onFocusChanged.addListener(() => void track());

chrome.alarms.create('orvyn-live', { periodInMinutes: 1 });
chrome.alarms.create('orvyn-beat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  void track();
  if (a.name !== 'orvyn-live') return;
  if (!ws) void startLive();
  void flushQueue();
  void pushSpans();
  void vault.expire().then(render, () => undefined);
  void focusState();
  void dueStashes();
  if (Math.random() < 0.01) void recall.tidy().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => void startLive());
chrome.runtime.onInstalled.addListener(() => {
  void menus();
  void startLive();
});
