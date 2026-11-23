'use client';

import type {
  ChatAttachment,
  ChatMessageView,
  ChatShareRef,
  ConversationView,
  ServerMessage,
} from '@orvyn/contracts';
import { b64, type DeviceKeys, openKey } from '@orvyn/vault-crypto';
import { uuidv7 as v7 } from '@orvyn/sync-client';
import { useEffect } from 'react';
import { API_URL, api, getAccessToken, refreshSession, uploadFile } from './api';
import { realtime } from './realtime';

/**
 * The web side of Chat (spec 0015 C, ADR-0016). Messages live on the server, so every browser and phone shows the
 * same history. A browser that once held end-to-end keys (ADR-0014) uses them only to carry its old messages over.
 */

export type Message = ChatMessageView & {
  /** on its way (shown with a clock) or failed (shown with Retry) — only on this device */
  local?: 'sending' | 'failed';
};

export interface Draft {
  text: string;
  replyTo?: string | null;
  attachments?: ChatAttachment[];
  share?: ChatShareRef | null;
  forwardOf?: string | null;
}

/** What the sending device shows at once, before the server confirms. */
export function optimistic(conversationId: string, senderId: string, d: Draft, id = v7()): Message {
  return {
    id,
    conversationId,
    senderId,
    kind: 'msg',
    v: 2,
    text: d.text,
    attachments: d.attachments ?? [],
    share: d.share ?? null,
    replyTo: null,
    reactions: [],
    forwarded: !!d.forwardOf,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    senderDeviceId: null,
    ciphertext: null,
    nonce: null,
    signature: null,
    sealedForMe: null,
    files: [],
    local: 'sending',
  };
}

export function sendMessage(conversationId: string, id: string, d: Draft) {
  return api<ChatMessageView>(`/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: {
      id,
      text: d.text,
      replyTo: d.replyTo ?? null,
      attachments: d.attachments ?? [],
      share: d.share ?? null,
      forwardOf: d.forwardOf ?? null,
    },
  });
}

async function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return null;
  try {
    const b = await createImageBitmap(file);
    const s = { w: b.width, h: b.height };
    b.close();
    return s;
  } catch {
    return null;
  }
}

/** Upload a photo or file for a chat; it is stored encrypted at rest like any file (ADR-0011). */
export async function uploadAttachment(file: File): Promise<ChatAttachment> {
  const [up, size] = await Promise.all([uploadFile(file, 'chat-file'), imageSize(file)]);
  return {
    fileId: up.id,
    name: file.name || up.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    ...(size ?? {}),
  };
}

const blobs = new Map<string, Promise<string>>();
/** A local URL for an attachment (fetched once per page load). */
export function attachmentUrl(conversationId: string, a: Pick<ChatAttachment, 'fileId' | 'mime'>) {
  const k = `${conversationId}/${a.fileId}`;
  let p = blobs.get(k);
  if (!p) {
    p = (async () => {
      const get = () =>
        fetch(`${API_URL}/chat/conversations/${conversationId}/files/${a.fileId}`, {
          credentials: 'include',
          headers: getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {},
        });
      let r = await get();
      if (r.status === 401 && (await refreshSession())) r = await get();
      if (!r.ok) throw new Error('download failed');
      return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: a.mime }));
    })();
    p.catch(() => blobs.delete(k));
    blobs.set(k, p);
  }
  return p;
}

export async function downloadAttachment(conversationId: string, a: ChatAttachment) {
  const url = await attachmentUrl(conversationId, a);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  link.click();
}

// ------------------------------------------------------------------ old end-to-end messages (ADR-0014 → ADR-0016)

function oldKeys(deviceId: string): Promise<DeviceKeys | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('orvyn-chat', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const r = open.result.transaction('keys', 'readonly').objectStore('keys').get(deviceId);
          r.onsuccess = () => resolve(r.result as DeviceKeys | undefined);
          r.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Hand the server the keys of old sealed messages this browser can open, so they become ordinary messages on every
 * device. The server checks each sender's signature first. Returns how many came over.
 */
export async function carryOver(deviceId: string, conversationId: string, page: ChatMessageView[]) {
  const sealed = page.filter((m) => m.v === 1 && m.sealedForMe);
  if (!sealed.length) return 0;
  const k = await oldKeys(deviceId);
  if (!k) return 0;
  const items: { id: string; key: string }[] = [];
  for (const m of sealed)
    try {
      items.push({ id: m.id, key: b64(await openKey(m.sealedForMe!, k.boxSecret)) });
    } catch {
      /* not for this browser after all */
    }
  if (!items.length) return 0;
  const r = await api<{ carried: number }>(`/chat/conversations/${conversationId}/carry`, {
    method: 'POST',
    body: { items },
  });
  return r.carried;
}

// ------------------------------------------------------------------ delivery

/**
 * While ORVYN is open anywhere, a new message from someone else counts as delivered (✓✓) at once — the chat itself
 * doesn't have to be open.
 */
export function useChatDelivery(meId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !meId) return;
    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const off = realtime?.on((m: ServerMessage) => {
      if (m.type !== 'chat.message') return;
      const msg = m.message as ChatMessageView | undefined;
      if (msg && msg.senderId === meId) return;
      clearTimeout(pending.get(m.conversationId));
      pending.set(
        m.conversationId,
        setTimeout(
          () =>
            void api(`/chat/conversations/${m.conversationId}/delivered`, { method: 'POST' }).catch(
              () => undefined,
            ),
          400,
        ),
      );
    });
    return () => {
      off?.();
      for (const t of pending.values()) clearTimeout(t);
    };
  }, [meId, enabled]);
}

// ------------------------------------------------------------------ words

export const display = (p: { name: string; email: string }) => p.name || p.email.split('@')[0]!;

export function attachmentLabel(a: ChatAttachment[]): string | null {
  if (!a.length) return null;
  const photos = a.filter((x) => x.mime.startsWith('image/')).length;
  if (photos === a.length) return photos === 1 ? '📷 Photo' : `📷 ${photos} photos`;
  if (a.length === 1 && a[0]!.mime.startsWith('audio/')) return '🎤 Voice message';
  if (a.length === 1 && a[0]!.mime.startsWith('video/')) return '🎬 Video';
  return a.length === 1 ? `📎 ${a[0]!.name}` : `📎 ${a.length} files`;
}

export function lastSeen(iso: string | null): string {
  if (!iso) return 'offline';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'last seen just now';
  if (mins < 60) return `last seen ${mins} min ago`;
  const today = new Date();
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `last seen today at ${t}`;
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString())
    return `last seen yesterday at ${t}`;
  return `last seen ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export type { ConversationView };
