'use client';

import { type Mutation, type PullResponse, type PushResult } from '@orvyn/contracts';
import { SyncClient } from '@orvyn/sync-client';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/bits';
import { api } from './api';
import { realtime } from './realtime';
import { useSession } from './session';

interface SyncCtx {
  client: SyncClient;
  /** bumps whenever local data changes (any module re-reads) */
  version: number;
  pending: number;
  /** write, then push in the background (offline: the outbox waits) */
  write<T>(fn: (c: SyncClient) => Promise<T>): Promise<T>;
}

const Ctx = createContext<SyncCtx | null>(null);

/** One offline mirror per signed-in person (database `orvyn-<userId>`) shared by every module, nudged live. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { me, deviceId } = useSession();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(0);
  const client = useMemo(() => {
    if (!me) return null;
    return new SyncClient(
      `orvyn-${me.id}`,
      {
        push: (mutations: Mutation[]) =>
          api<PushResult>('/sync/push', { method: 'POST', body: { mutations } }),
        pull: (cursor) => api<PullResponse>(`/sync/pull${cursor ? `?cursor=${cursor}` : ''}`),
      },
      `w${(deviceId ?? 'web').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`,
    );
  }, [me, deviceId]);

  useEffect(() => {
    if (!client) return;
    const bump = () => {
      setVersion((v) => v + 1);
      void client.pendingCount().then(setPending);
    };
    const off = client.onChange(bump);
    // the server refused a change: say so (a duplicate payment is just dropped), and show the server's truth
    const offRejected = client.onRejected((r) => {
      if (r.reason === 'duplicate') return;
      toast({
        title: 'A change couldn’t be saved',
        body:
          r.reason === 'forbidden' || r.reason === 'feature_not_enabled'
            ? 'That module isn’t enabled for you.'
            : undefined,
        tone: 'danger',
      });
    });
    const sync = () => client.sync().catch(() => undefined);
    bump();
    void sync();
    const offLive = realtime?.on((m) => m.type === 'sync.changed' && void sync());
    window.addEventListener('online', sync);
    const t = setInterval(sync, 60_000);
    return () => {
      off();
      offRejected();
      offLive?.();
      window.removeEventListener('online', sync);
      clearInterval(t);
      client.close();
    };
  }, [client, toast]);

  const value = useMemo<SyncCtx | null>(
    () =>
      client
        ? {
            client,
            version,
            pending,
            write: async (fn) => {
              const r = await fn(client);
              void client.sync().catch(() => undefined);
              return r;
            },
          }
        : null,
    [client, version, pending],
  );
  return value ? <Ctx.Provider value={value}>{children}</Ctx.Provider> : <>{children}</>;
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSync outside SyncProvider');
  return c;
}
