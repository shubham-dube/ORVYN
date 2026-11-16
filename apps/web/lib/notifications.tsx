'use client';

import type { NotificationView } from '@orvyn/contracts';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/bits';
import { api } from './api';
import { realtime } from './realtime';
import { useSession } from './session';

interface Ctx {
  items: NotificationView[];
  unread: number;
  dismiss(id: string): Promise<void>;
  dismissAll(): Promise<void>;
  markRead(id: string): Promise<void>;
}
const NCtx = createContext<Ctx | null>(null);

/** Live notification centre: loads once, then stays in step with every device over the socket. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const toast = useToast();
  const [items, setItems] = useState<NotificationView[]>([]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    api<{ items: NotificationView[] }>('/notifications').then(
      (r) => setItems(r.items),
      () => undefined,
    );
  }, [status]);

  useEffect(
    () =>
      realtime?.on((m) => {
        if (m.type === 'notify.new') {
          setItems((xs) => [m.notification, ...xs.filter((x) => x.id !== m.notification.id)]);
          toast({ title: m.notification.title, body: m.notification.body });
        }
        if (m.type === 'notify.dismissed') setItems((xs) => xs.filter((x) => x.id !== m.id));
        if (m.type === 'notify.read')
          setItems((xs) => xs.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)));
      }),
    [toast],
  );

  const dismiss = useCallback(async (id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await api(`/notifications/${id}/dismiss`, { method: 'POST' });
  }, []);
  const dismissAll = useCallback(async () => {
    setItems([]);
    await api('/notifications/dismiss-all', { method: 'POST' });
  }, []);
  const markRead = useCallback(async (id: string) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x)));
    await api(`/notifications/${id}/read`, { method: 'POST' });
  }, []);

  return (
    <NCtx.Provider
      value={{ items, unread: items.filter((i) => !i.readAt).length, dismiss, dismissAll, markRead }}
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
