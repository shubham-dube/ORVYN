/// <reference types="chrome" />
import { Hlc, type NotificationView, type ServerMessage } from '@orvyn/contracts';
import { API_URL, VERSION, WEB_URL } from './config';
import {
  badgeText,
  captureMutations,
  Client,
  codeFromCallback,
  connectUrl,
  notificationButtons,
  pkce,
  type Request,
  type Status,
  type Store,
  unreadCount,
} from './core';

const store: Store = {
  get: async (k) => (await chrome.storage.local.get(k))[k] as string | undefined,
  set: async (k, v) =>
    v === undefined ? chrome.storage.local.remove(k) : chrome.storage.local.set({ [k]: v }),
};
const client = new Client(API_URL, store);
let notifications: NotificationView[] = [];
let ws: WebSocket | null = null;
let live = false;
let keepAlive: ReturnType<typeof setInterval> | undefined;

client.onSignedOut = () => {
  closeSocket();
  notifications = [];
  void render();
};

// ------------------------------------------------------------------ connect / disconnect

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
  await client.redeem(code, verifier, `ORVYN for ${name}`, VERSION);
  await startLive();
}

// ------------------------------------------------------------------ live updates

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
    // reconnect is driven by the 1-minute alarm (service workers may sleep in between)
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

async function onMessage(m: ServerMessage): Promise<void> {
  switch (m.type) {
    case 'hello':
      live = true;
      break;
    case 'notify.new':
      if (!notifications.some((n) => n.id === m.notification.id)) {
        notifications = [m.notification, ...notifications].slice(0, 50);
        chrome.notifications.create(m.notification.id, {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: m.notification.title,
          message: m.notification.body || ' ',
          priority: m.notification.priority === 'urgent' ? 2 : 0,
          buttons: notificationButtons(m.notification).map((b) => ({ title: b.title })),
        });
      }
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
  await chrome.action.setBadgeText({ text: badgeText(n) });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a56c4' });
  await chrome.action.setTitle({ title: n ? `ORVYN — ${n} new` : 'ORVYN' });
}

async function status(error?: string, saved?: string): Promise<Status> {
  return { connected: await client.isConnected(), me: await client.me(), live, notifications, error, saved };
}

const clock = new Hlc(`x${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The popup's field: to Today (read by the same parser as everywhere, AI only for what it can't read) or to Drop. */
async function capture(target: 'today' | 'drop', text: string): Promise<string> {
  if (!text.trim()) throw new Error('Type something first');
  const parsed =
    target === 'today'
      ? await client.call<Parameters<typeof captureMutations>[2]>('POST', '/today/parse', { text, ai: true })
      : null;
  const mutations = captureMutations(target, text, parsed, {
    stamp: () => clock.tick(),
    id: () => crypto.randomUUID(),
    today: localDay(),
  });
  const r = await client.call<{ rejected: { reason: string }[] }>('POST', '/sync/push', { mutations });
  if (r.rejected.length)
    throw new Error(r.rejected[0]!.reason === 'feature_not_enabled' ? 'not enabled for you' : 'not saved');
  return target === 'today'
    ? `Added to Today: ${parsed?.title ?? text}`
    : 'Dropped — a suggestion is on its way';
}

// ------------------------------------------------------------------ wiring

chrome.runtime.onMessage.addListener((req: Request, _sender, reply) => {
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
      return await status();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      return status(msg.includes('did not approve') || msg === 'cancelled' ? 'cancelled' : msg);
    }
  };
  void run().then(reply);
  return true; // async reply
});

chrome.notifications.onButtonClicked.addListener(
  (id, button) => void (button === 0 ? open(id) : dismiss(id)),
);
chrome.notifications.onClicked.addListener((id) => void open(id));
chrome.alarms.create('orvyn-live', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => void (ws ? undefined : startLive()));
chrome.runtime.onStartup.addListener(() => void startLive());
chrome.runtime.onInstalled.addListener(() => void startLive());
