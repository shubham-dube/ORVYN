'use client';

import type { ChatMessageView, ChatPayload, ConversationView } from '@orvyn/contracts';
import {
  BadChatData,
  decryptFile,
  decryptMessage,
  type DeviceKeys,
  encryptFile,
  encryptMessage,
  fingerprint,
  newDeviceKeys,
} from '@orvyn/vault-crypto';
import { uuidv7 as v7 } from '@orvyn/sync-client';
import { API_URL, api, getAccessToken, refreshSession, uploadFile } from './api';

/**
 * The web side of Chat (spec 0011, ADR-0014): this browser's device keys live in IndexedDB (never sent anywhere),
 * every message is encrypted here for every device of every member, and decrypted here.
 */

const DB = 'orvyn-chat';
const STORE = 'keys';

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    };
  });
}

let mine: Promise<DeviceKeys> | null = null;

/** This device's keys: made once, kept in this browser, public halves registered with the server. */
export function deviceKeys(deviceId: string): Promise<DeviceKeys> {
  return (mine ??= (async () => {
    let k = await idb<DeviceKeys | undefined>(
      'readonly',
      (s) => s.get(deviceId) as IDBRequest<DeviceKeys | undefined>,
    );
    if (!k) {
      k = await newDeviceKeys();
      await idb('readwrite', (s) => s.put(k, deviceId));
    }
    await api('/chat/devices', { method: 'PUT', body: { boxPublic: k.boxPublic, signPublic: k.signPublic } });
    return k;
  })().catch((e) => {
    mine = null;
    throw e;
  }));
}

export interface DeviceKey {
  userId: string;
  deviceId: string;
  boxPublic: string;
  signPublic: string;
  active: boolean;
}
const keyCache = new Map<string, DeviceKey[]>();
export async function memberKeys(userIds: string[], fresh = false): Promise<DeviceKey[]> {
  const k = [...userIds].sort().join(',');
  if (!fresh && keyCache.has(k)) return keyCache.get(k)!;
  const r = await api<DeviceKey[]>(`/chat/keys?userIds=${k}`);
  keyCache.set(k, r);
  return r;
}

export async function send(
  deviceId: string,
  conv: Pick<ConversationView, 'id' | 'members'>,
  payload: ChatPayload,
  files: string[] = [],
) {
  const me = await deviceKeys(deviceId);
  const devices = (
    await memberKeys(
      conv.members.map((m) => m.id),
      true,
    )
  ).filter((d) => d.active);
  const id = v7();
  const sealed = await encryptMessage(payload, {
    conversationId: conv.id,
    messageId: id,
    deviceId,
    signSecret: me.signSecret,
    recipients: devices.map((d) => ({ deviceId: d.deviceId, boxPublic: d.boxPublic })),
  });
  await api(`/chat/conversations/${conv.id}/messages`, { method: 'POST', body: { id, ...sealed, files } });
  return id;
}

/** Encrypt a file here, upload the opaque bytes, and return the message payload that carries its key. */
export async function sendFile(
  deviceId: string,
  conv: Pick<ConversationView, 'id' | 'members'>,
  file: File,
  caption = '',
) {
  const enc = await encryptFile(new Uint8Array(await file.arrayBuffer()));
  const up = await uploadFile(
    new File([new Uint8Array(enc.bytes)], 'encrypted.bin', { type: 'application/octet-stream' }),
    'chat',
  );
  return send(
    deviceId,
    conv,
    {
      t: 'file',
      fileId: up.id,
      key: enc.key,
      nonce: enc.nonce,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      caption,
    },
    [up.id],
  );
}

export async function openFile(
  conversationId: string,
  p: Extract<ChatPayload, { t: 'file' }>,
): Promise<Blob> {
  const get = () =>
    fetch(`${API_URL}/chat/conversations/${conversationId}/files/${p.fileId}`, {
      credentials: 'include',
      headers: getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {},
    });
  let r = await get();
  if (r.status === 401 && (await refreshSession())) r = await get();
  if (!r.ok) throw new Error('download failed');
  const plain = await decryptFile(new Uint8Array(await r.arrayBuffer()), p.key, p.nonce);
  return new Blob([new Uint8Array(plain)], { type: p.mime });
}

/** One line in the thread after decryption, with reactions and edits folded in. */
export interface Line {
  id: string;
  senderId: string;
  at: string;
  kind: 'msg' | 'system' | 'deleted' | 'unreadable';
  payload: Extract<ChatPayload, { t: 'text' | 'file' | 'share' }> | null;
  text: string | null;
  edited: boolean;
  reactions: { emoji: string; by: string[] }[];
}

/** Decrypt a page and fold reactions and edits into the messages they point at (oldest first). */
export async function readPage(deviceId: string, page: ChatMessageView[]): Promise<Line[]> {
  const me = await deviceKeys(deviceId);
  const signers = new Map(
    (await memberKeys([...new Set(page.map((m) => m.senderId))], true)).map((d) => [
      d.deviceId,
      d.signPublic,
    ]),
  );
  const lines: Line[] = [];
  const reacts: { target: string; by: string; emoji: string | null; at: string }[] = [];
  const edits: { target: string; by: string; text: string; at: string }[] = [];
  for (const m of [...page].reverse()) {
    const base = {
      id: m.id,
      senderId: m.senderId,
      at: m.createdAt,
      edited: false,
      reactions: [],
      text: null,
      payload: null,
    };
    if (m.kind === 'system') {
      lines.push({ ...base, kind: 'system', text: m.text });
      continue;
    }
    if (m.deletedAt) {
      lines.push({ ...base, kind: 'deleted' });
      continue;
    }
    try {
      const sign = m.senderDeviceId ? signers.get(m.senderDeviceId) : undefined;
      if (!m.sealedForMe || !sign || !m.senderDeviceId || !m.ciphertext || !m.nonce || !m.signature)
        throw new BadChatData('not for this device');
      const p = await decryptMessage<ChatPayload>(
        {
          conversationId: m.conversationId,
          id: m.id,
          senderDeviceId: m.senderDeviceId,
          ciphertext: m.ciphertext,
          nonce: m.nonce,
          signature: m.signature,
        },
        m.sealedForMe,
        me.boxSecret,
        sign,
      );
      if (p.t === 'react') reacts.push({ target: p.target, by: m.senderId, emoji: p.emoji, at: m.createdAt });
      else if (p.t === 'edit')
        edits.push({ target: p.target, by: m.senderId, text: p.text, at: m.createdAt });
      else lines.push({ ...base, kind: 'msg', payload: p });
    } catch {
      lines.push({ ...base, kind: 'unreadable' });
    }
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const e of edits) {
    const l = byId.get(e.target);
    if (l?.payload?.t === 'text' && l.senderId === e.by) {
      l.payload = { ...l.payload, text: e.text };
      l.edited = true;
    }
  }
  const latest = new Map<string, string | null>();
  for (const r of reacts) latest.set(`${r.target}|${r.by}`, r.emoji);
  for (const [k, emoji] of latest) {
    if (!emoji) continue;
    const [target, by] = k.split('|') as [string, string];
    const l = byId.get(target);
    if (!l) continue;
    const g = l.reactions.find((x) => x.emoji === emoji);
    if (g) g.by.push(by);
    else l.reactions.push({ emoji, by: [by] });
  }
  return lines;
}

export { fingerprint };
