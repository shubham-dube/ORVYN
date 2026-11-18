'use client';

import { LIBRARY_DOC, type LibraryDoc, LibraryDocFields } from '@orvyn/contracts';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { uploadFile } from './api';
import { useSync } from './sync';

interface LibraryCtx {
  ready: boolean;
  docs: LibraryDoc[];
  addNote(f: { title: string; text: string; category?: string; tags?: string[] }): Promise<string>;
  /** upload the file, then add a document that the server reads (status new) */
  addFile(file: File): Promise<string>;
  update(id: string, f: Partial<LibraryDoc>): Promise<void>;
  remove(id: string): Promise<void>;
  /** ask the server to read it again */
  reread(id: string): Promise<void>;
}

const Ctx = createContext<LibraryCtx | null>(null);
const DEFAULTS = LibraryDocFields.parse({});

/** The Library's documents from the shared offline mirror. */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const { client, version, write } = useSync();
  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    const list = await client.list<LibraryDoc>(LIBRARY_DOC);
    setDocs(list.map((d) => ({ ...DEFAULTS, ...d })).sort((a, b) => b.id.localeCompare(a.id)));
    setReady(true);
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload, version]);

  const value = useMemo<LibraryCtx>(
    () => ({
      ready,
      docs,
      addNote: (f) =>
        write((c) =>
          c.upsert(LIBRARY_DOC, {
            kind: 'note',
            title: f.title.trim(),
            text: f.text,
            category: f.category ?? 'Notes',
            tags: f.tags ?? [],
            status: 'new',
            source: 'web',
          }),
        ),
      addFile: async (file) => {
        const up = await uploadFile(file, 'library');
        return write((c) =>
          c.upsert(LIBRARY_DOC, {
            kind: 'file',
            fileId: up.id,
            fileName: file.name.slice(0, 200),
            mime: file.type.slice(0, 100),
            size: file.size,
            status: 'new',
            source: 'web',
          }),
        );
      },
      update: (id, f) => write(async (c) => void (await c.upsert(LIBRARY_DOC, f, id))),
      remove: (id) => write((c) => c.remove(LIBRARY_DOC, id)),
      reread: (id) => write(async (c) => void (await c.upsert(LIBRARY_DOC, { status: 'new' }, id))),
    }),
    [ready, docs, write],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLibrary outside LibraryProvider');
  return c;
}
export const useLibraryMaybe = () => useContext(Ctx);
