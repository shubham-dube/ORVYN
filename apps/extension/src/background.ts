/// <reference types="chrome" />
import type { NotificationView, ServerMessage } from '@orvyn/contracts';
import { API_URL, VERSION, WEB_URL } from './config';
import {
  badgeText,
  Client,
  codeFromCallback,
  connectUrl,
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
          buttons: [{ title: 'Open' }, { title: 'Dismiss' }],
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

async function status(error?: string): Promise<Status> {
  return { connected: await client.isConnected(), me: await client.me(), live, notifications, error };
}

// ------------------------------------------------------------------ wiring

chrome.runtime.onMessage.addListener((req: Request, _sender, reply) => {
  const run = async (): Promise<Status> => {
    try {
      if (req.type === 'connect') await connect();
      if (req.type === 'disconnect') await client.signOut();
      if (req.type === 'dismiss') await dismiss(req.id);
      if (req.type === 'test') await client.call('POST', '/notifications/test');
      if (req.type === 'status' && !ws) await startLive();
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
