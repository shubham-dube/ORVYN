import { api } from './api';

const b64ToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Ask permission, subscribe this browser (or installed PWA, incl. iPhone home-screen apps) and register it. */
export async function enablePush(): Promise<'enabled' | 'denied' | 'unsupported' | 'not_configured'> {
  if (!pushSupported()) return 'unsupported';
  const { key } = await api<{ key: string | null }>('/notifications/vapid-public-key', { auth: false });
  if (!key) return 'not_configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/notifications/targets', {
    method: 'POST',
    body: { channel: 'webpush', subscription: { endpoint: json.endpoint, keys: json.keys } },
  });
  return 'enabled';
}

/** Browsers renew or drop subscriptions by themselves: one that was allowed is registered again when ORVYN opens. */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  await enablePush();
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}
