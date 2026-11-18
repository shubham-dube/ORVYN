'use client';

import { VAULT_ITEM, VAULT_KEYS, type VaultItemFields, type VaultKeysFields } from '@orvyn/contracts';
import {
  changePassphrase as cryptoChange,
  createVault,
  decryptItem,
  encryptItem,
  resetPassphrase,
  unlock as cryptoUnlock,
  type VaultKeys,
} from '@orvyn/vault-crypto';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSession } from './session';
import { useSync } from './sync';
import type { VaultPayload } from './vault-items';

export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked';
export interface OpenItem {
  id: string;
  payload: VaultPayload;
}

interface VaultCtx {
  status: VaultStatus;
  items: OpenItem[];
  /** items that did not decrypt (damaged or from another key) */
  unreadable: number;
  autoLockMin: number;
  setAutoLockMin(m: number): void;
  /** first-time setup; returns the recovery key, to be shown once */
  setup(passphrase: string): Promise<string>;
  unlock(passphrase: string): Promise<void>;
  unlockWithRecovery(recoveryKey: string, newPassphrase: string): Promise<void>;
  lock(): void;
  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void>;
  saveItem(id: string | null, payload: VaultPayload): Promise<string>;
  removeItem(id: string): Promise<void>;
  /** copy, and clear the clipboard again after 30 seconds */
  copySecret(text: string): Promise<void>;
}

const Ctx = createContext<VaultCtx | null>(null);
const CLIPBOARD_MS = 30_000;
const LOCK_KEY = 'orvyn.vault.autolock';

/**
 * The Vault on this device (ADR-0004). The vault key lives only in this module's memory while unlocked — never in
 * storage, never in state that is logged — and is wiped on lock. Everything the server sees is ciphertext.
 */
export function VaultProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { client, version, write } = useSync();
  const [keys, setKeys] = useState<VaultKeys | null | undefined>(undefined);
  const [blobs, setBlobs] = useState<{ id: string; blob: string }[]>([]);
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [items, setItems] = useState<OpenItem[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [autoLockMin, setAutoLock] = useState(5);
  const key = useRef<Uint8Array | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(LOCK_KEY));
      if ([1, 5, 15, 30, 0].includes(v) && localStorage.getItem(LOCK_KEY) !== null) setAutoLock(v);
    } catch {
      /* storage blocked: the default */
    }
  }, []);

  const reloads = useRef(0);
  const reload = useCallback(async () => {
    if (!me) return;
    const mine = ++reloads.current;
    const [k, list] = await Promise.all([
      client.get<VaultKeysFields>(VAULT_KEYS, me.id),
      client.list<VaultItemFields & { id: string }>(VAULT_ITEM),
    ]);
    if (mine !== reloads.current) return; // a newer read is on its way: never let an old one overwrite it
    setKeys(k ? { pass: k.pass, recovery: k.recovery } : null);
    setBlobs(list.map((i) => ({ id: i.id, blob: i.blob })));
  }, [client, me]);
  useEffect(() => {
    void reload();
  }, [reload, version]);

  const lock = useCallback(() => {
    key.current?.fill(0);
    key.current = null;
    if (timer.current) clearTimeout(timer.current);
    setItems([]);
    setUnreadable(0);
    setStatus((s) => (s === 'unlocked' ? 'locked' : s));
  }, []);

  // status follows what exists and whether the key is held
  useEffect(() => {
    if (keys === undefined) return;
    if (keys === null) setStatus('none');
    else setStatus(key.current ? 'unlocked' : 'locked');
  }, [keys]);

  // decrypt (again) whenever the key is held and the blobs change
  useEffect(() => {
    const vk = key.current;
    if (!vk || status !== 'unlocked') return;
    let cancelled = false;
    void (async () => {
      const out: OpenItem[] = [];
      let bad = 0;
      for (const b of blobs) {
        try {
          out.push({ id: b.id, payload: await decryptItem<VaultPayload>(vk, b.id, b.blob) });
        } catch {
          bad++;
        }
      }
      if (!cancelled) {
        setItems(out.sort((a, b) => a.payload.title.localeCompare(b.payload.title)));
        setUnreadable(bad);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blobs, status]);

  // auto-lock after inactivity
  useEffect(() => {
    if (status !== 'unlocked' || autoLockMin === 0) return;
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(lock, autoLockMin * 60_000);
    };
    arm();
    const events = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, arm);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [status, autoLockMin, lock]);

  // leaving (sign-out, closing) wipes the key
  useEffect(() => {
    const wipe = () => lock();
    window.addEventListener('pagehide', wipe);
    return () => window.removeEventListener('pagehide', wipe);
  }, [lock]);
  useEffect(() => {
    if (!me) lock();
  }, [me, lock]);

  const value = useMemo<VaultCtx>(
    () => ({
      status,
      items,
      unreadable,
      autoLockMin,
      setAutoLockMin: (m) => {
        setAutoLock(m);
        try {
          localStorage.setItem(LOCK_KEY, String(m));
        } catch {
          /* fine */
        }
      },
      setup: async (passphrase) => {
        const made = await createVault(passphrase);
        await write((c) => c.upsert(VAULT_KEYS, { ...made.keys }, me!.id));
        key.current = made.vaultKey;
        setKeys(made.keys);
        setStatus('unlocked');
        return made.recoveryKey;
      },
      unlock: async (passphrase) => {
        if (!keys) throw new Error('no vault');
        key.current = await cryptoUnlock(keys, passphrase);
        setStatus('unlocked');
      },
      unlockWithRecovery: async (recoveryKey, newPassphrase) => {
        if (!keys) throw new Error('no vault');
        const r = await resetPassphrase(keys, recoveryKey, newPassphrase);
        await write((c) => c.upsert(VAULT_KEYS, { pass: r.keys.pass }, me!.id));
        key.current = r.vaultKey;
        reloads.current++; // reads that started before this change are out of date
        setKeys(r.keys);
        setStatus('unlocked');
      },
      lock,
      changePassphrase: async (oldPassphrase, newPassphrase) => {
        if (!keys) throw new Error('no vault');
        const next = await cryptoChange(keys, oldPassphrase, newPassphrase);
        await write((c) => c.upsert(VAULT_KEYS, { pass: next.pass }, me!.id));
        reloads.current++;
        setKeys(next);
      },
      saveItem: async (id, payload) => {
        const vk = key.current;
        if (!vk) throw new Error('locked');
        const itemId = id ?? crypto.randomUUID();
        const blob = await encryptItem(vk, itemId, { ...payload, updatedAt: new Date().toISOString() });
        await write((c) => c.upsert(VAULT_ITEM, { blob }, itemId));
        return itemId;
      },
      removeItem: (id) => write((c) => c.remove(VAULT_ITEM, id)),
      copySecret: async (text) => {
        await navigator.clipboard.writeText(text);
        setTimeout(() => {
          navigator.clipboard.writeText('').catch(() => undefined);
        }, CLIPBOARD_MS);
      },
    }),
    [status, items, unreadable, autoLockMin, keys, lock, write, me],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault(): VaultCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useVault outside VaultProvider');
  return c;
}
export const useVaultMaybe = () => useContext(Ctx);
