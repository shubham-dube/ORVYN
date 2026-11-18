'use client';

import {
  DROP_ITEM,
  type DropItem,
  type DropProposal,
  MONEY_CATEGORY,
  MONEY_TRANSACTION,
  TODAY_EVENT,
  TODAY_TASK,
  type Category,
} from '@orvyn/contracts';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { uploadFile } from './api';
import { voiceFileName } from './voice';
import { useSync } from './sync';

interface DropCtx {
  /** false until the first read from the local store */
  ready: boolean;
  items: DropItem[];
  dropText(
    text: string,
    o?: { kind?: 'text' | 'voice' | 'link'; source?: DropItem['source'] },
  ): Promise<string>;
  dropFile(file: File, caption?: string): Promise<string>;
  /** a voice note: the recording is kept as a file, the words are what the AI reads */
  dropVoice(recording: Blob, words: string): Promise<string>;
  /** create what the (possibly edited) proposal describes, then mark the item done; edits are kept as a correction */
  confirm(item: DropItem, p: DropProposal): Promise<void>;
  keep(item: DropItem): Promise<void>;
  dismiss(item: DropItem): Promise<void>;
  retry(item: DropItem): Promise<void>;
}

const Ctx = createContext<DropCtx | null>(null);
const URL_ONLY = /^https?:\/\/\S+$/i;

export function DropProvider({ children }: { children: ReactNode }) {
  const { client, version, write } = useSync();
  const [items, setItems] = useState<DropItem[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const list = await client.list<DropItem & { createdAt?: string }>(DROP_ITEM);
    // newest first: ids are time-ordered (uuid v7)
    setItems([...list].sort((a, b) => b.id.localeCompare(a.id)));
    setReady(true);
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload, version]);

  const value = useMemo<DropCtx>(() => {
    const set = (id: string, f: Partial<DropItem>) =>
      write(async (c) => void (await c.upsert(DROP_ITEM, f, id)));
    return {
      ready,
      items,
      dropText: (text, o = {}) =>
        write((c) =>
          c.upsert(DROP_ITEM, {
            kind: o.kind ?? (URL_ONLY.test(text.trim()) ? 'link' : 'text'),
            text: URL_ONLY.test(text.trim()) ? '' : text.trim(),
            url: URL_ONLY.test(text.trim()) ? text.trim() : null,
            source: o.source ?? 'web',
            status: 'new',
          }),
        ),
      dropVoice: async (recording, words) => {
        const name = voiceFileName(recording);
        const f = await uploadFile(
          new File([recording], name, { type: recording.type || 'audio/webm' }),
          'voice',
        );
        return write((c) =>
          c.upsert(DROP_ITEM, {
            kind: 'voice',
            fileId: f.id,
            fileName: name,
            text: words.trim(),
            source: 'web',
            status: 'new',
          }),
        );
      },
      dropFile: async (file, caption = '') => {
        const f = await uploadFile(file);
        return write((c) =>
          c.upsert(DROP_ITEM, {
            kind: file.type.startsWith('image/') ? 'photo' : 'file',
            fileId: f.id,
            fileName: f.name,
            text: caption,
            source: 'web',
            status: 'new',
          }),
        );
      },
      confirm: (item, p) =>
        write(async (c) => {
          let ref: string | null = null;
          if (p.kind === 'task') {
            ref = `${TODAY_TASK}:${await c.upsert(TODAY_TASK, {
              title: p.title,
              notes: p.notes,
              dueDate: p.dueAt ? null : p.dueDate,
              dueAt: p.dueAt,
              durationMin: p.durationMin,
              priority: p.priority,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              source: 'drop',
            })}`;
          } else if (p.kind === 'event') {
            ref = `${TODAY_EVENT}:${await c.upsert(TODAY_EVENT, {
              title: p.title,
              start: p.start,
              end: p.end,
              location: p.location,
              notes: p.notes,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}`;
          } else if (p.kind === 'expense') {
            const cats = await c.list<Category>(MONEY_CATEGORY);
            const cat = cats.find((x) => x.name.toLowerCase() === p.category.toLowerCase());
            ref = `${MONEY_TRANSACTION}:${await c.upsert(MONEY_TRANSACTION, {
              amountMinor: Math.round(p.amount * 100),
              currency: p.currency,
              direction: p.direction,
              merchant: p.merchant,
              categoryId: cat?.id ?? null,
              note: p.note,
              occurredAt: p.occurredAt ?? new Date().toISOString(),
              source: item.kind === 'photo' ? 'receipt' : 'drop',
              receiptFileId: item.kind === 'photo' ? item.fileId : null,
              dropItemId: item.id,
            })}`;
          }
          const changed = JSON.stringify(p) !== JSON.stringify(item.proposal);
          await c.upsert(
            DROP_ITEM,
            {
              status: p.kind === 'note' ? 'kept' : 'done',
              resultRef: ref,
              correction: changed ? p : null,
            },
            item.id,
          );
        }),
      keep: (item) => set(item.id, { status: 'kept' }),
      dismiss: (item) => set(item.id, { status: 'dismissed' }),
      retry: (item) => set(item.id, { status: 'new' }),
    };
  }, [ready, items, write]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDrop = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDrop outside DropProvider');
  return c;
};
export const useDropMaybe = () => useContext(Ctx);
