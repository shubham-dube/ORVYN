'use client';

import type { NotificationView } from '@orvyn/contracts';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/bits';
import { api } from './api';
import { refreshPush } from './push';
import { realtime } from './realtime';
import { useSession } from './session';

interface Ctx {
  items: NotificationView[];
  unread: number;
  dismiss(id: string): Promise<void>;
  dismissAll(): Promise<void>;
  markRead(id: string): Promise<void>;
  /** press an action button (Done, Snooze 10 min, …); the server does it and clears it everywhere */
  act(id: string, actionId: string, text?: string): Promise<void>;
}
const NCtx = createContext<Ctx | null>(null);

/** Live notification centre: loads once, then stays in step with every device over the socket. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<NotificationView[]>([]);

  const load = useCallback(
    () =>
      api<{ items: NotificationView[] }>('/notifications').then(
        (r) => setItems(r.items),
        () => undefined,
      ),
    [],
  );

  useEffect(() => {
    if (status !== 'signedIn') return;
    void load();
    void refreshPush().catch(() => undefined);
  }, [status, load]);

  useEffect(
    () =>
      realtime?.on((m) => {
        if (m.type === 'hello') void load(); // what came, or went, while the connection was down
        if (m.type === 'notify.new') {
          setItems((xs) => [m.notification, ...xs.filter((x) => x.id !== m.notification.id)]);
          if (!m.notification.silent) toast({ title: m.notification.title, body: m.notification.body });
        }
        if (m.type === 'notify.dismissed') setItems((xs) => xs.filter((x) => x.id !== m.id));
        if (m.type === 'notify.read')
          setItems((xs) => xs.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)));
      }),
    [toast, load],
  );

  const dismiss = useCallback(async (id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await api(`/notifications/${id}/dismiss`, { method: 'POST' });
  }, []);
  const dismissAll = useCallback(async () => {
    setItems([]);
    await api('/notifications/dismiss-all', { method: 'POST' });
  }, []);
  const act = useCallback(
    async (id: string, actionId: string, text?: string) => {
      const before = items;
      setItems((xs) => xs.filter((x) => x.id !== id));
      try {
        await api(`/notifications/${id}/actions/${encodeURIComponent(actionId)}`, {
          method: 'POST',
          body: text === undefined ? {} : { text },
        });
      } catch (e) {
        const back = before.find((x) => x.id === id);
        if (back) setItems((xs) => (xs.some((x) => x.id === id) ? xs : [back, ...xs]));
        throw e;
      }
    },
    [items],
  );
  // a button pressed on a web push notification arrives as /?notification=…&action=… (see public/sw.js)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('notification');
    const action = q.get('action');
    if (!id || status !== 'signedIn') return;
    q.delete('notification');
    q.delete('action');
    const rest = q.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash,
    );
    // opened by a tap on it: read everywhere
    if (!action) return void api(`/notifications/${id}/read`, { method: 'POST' }).then(load, () => undefined);
    void act(id, action).then(
      () => toast({ title: 'Done', tone: 'success' }),
      () => toast({ title: 'That didn’t work', tone: 'danger' }),
    );
  }, [act, toast, status, load]);
  const markRead = useCallback(async (id: string) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x)));
    await api(`/notifications/${id}/read`, { method: 'POST' });
  }, []);

  return (
    <NCtx.Provider
      value={{ items, unread: items.filter((i) => !i.readAt).length, dismiss, dismissAll, markRead, act }}
    >
      {children}
    </NCtx.Provider>
  );
}

export function useNotifications(): Ctx {
  const c = useContext(NCtx);
  if (!c) throw new Error('useNotifications outside provider');
  return c;
}
