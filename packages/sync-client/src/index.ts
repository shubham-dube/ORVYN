import { type Change, Hlc, type Mutation, type PullResponse, type PushResult } from '@orvyn/contracts';
import Dexie, { type Table } from 'dexie';

/**
 * Offline-first sync for web and the extension (ADR-0006) — the same algorithm as apps/mobile/lib/sync:
 * writes land in IndexedDB and the outbox at once; `sync()` pushes the outbox, then pulls after the cursor; a pull
 * never hides an edit that hasn't been acknowledged yet. The server merges per field by HLC.
 */
export interface LocalRecord {
  entity: string;
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  updatedAt: number;
}

export interface PendingMutation extends Mutation {
  createdAt: number;
}

export interface Transport {
  push(mutations: Mutation[]): Promise<PushResult>;
  pull(cursor: string | null): Promise<PullResponse>;
}

export interface Rejection {
  mutationId: string;
  entity: string;
  entityId: string;
  reason: string;
}

class LocalDb extends Dexie {
  records!: Table<LocalRecord, [string, string]>;
  outbox!: Table<PendingMutation, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      records: '[entity+id], entity',
      outbox: 'mutationId, createdAt, [entity+entityId]',
      meta: 'key',
    });
  }
}

const uuidv7 = (): string => {
  const ms = BigInt(Date.now());
  const b = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export class SyncClient {
  readonly db: LocalDb;
  readonly hlc: Hlc;
  private running: Promise<void> | null = null;
  private again = false;
  private listeners = new Set<() => void>();
  private rejectionListeners = new Set<(r: Rejection) => void>();

  /** `name` scopes the database: use one per signed-in person so accounts never mix on a shared browser. */
  constructor(
    name: string,
    private readonly transport: Transport,
    node: string,
    now?: () => number,
  ) {
    this.db = new LocalDb(name);
    this.hlc = new Hlc(node, now);
  }

  /** Called after any local or pulled change; UIs re-read. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRejected(fn: (r: Rejection) => void): () => void {
    this.rejectionListeners.add(fn);
    return () => this.rejectionListeners.delete(fn);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- writes

  async upsert(entity: string, fields: Record<string, unknown>, id: string = uuidv7()): Promise<string> {
    const hlc = this.hlc.tick();
    await this.db.transaction('rw', this.db.records, this.db.outbox, async () => {
      const cur = await this.db.records.get([entity, id]);
      await this.db.records.put({
        entity,
        id,
        data: { ...(cur && !cur.deleted ? cur.data : {}), ...fields, id },
        deleted: false,
        updatedAt: Date.now(),
      });
      await this.db.outbox.put({
        mutationId: uuidv7(),
        entity,
        entityId: id,
        op: 'upsert',
        fields,
        hlc,
        createdAt: Date.now(),
      });
    });
    this.changed();
    return id;
  }

  async remove(entity: string, id: string): Promise<void> {
    const hlc = this.hlc.tick();
    await this.db.transaction('rw', this.db.records, this.db.outbox, async () => {
      const cur = await this.db.records.get([entity, id]);
      await this.db.records.put({
        entity,
        id,
        data: cur?.data ?? { id },
        deleted: true,
        updatedAt: Date.now(),
      });
      await this.db.outbox.put({
        mutationId: uuidv7(),
        entity,
        entityId: id,
        op: 'delete',
        fields: {},
        hlc,
        createdAt: Date.now(),
      });
    });
    this.changed();
  }

  // ---------------------------------------------------------------- reads

  async list<T = Record<string, unknown>>(entity: string): Promise<T[]> {
    const rows = await this.db.records.where('entity').equals(entity).toArray();
    return rows.filter((r) => !r.deleted).map((r) => r.data as T);
  }

  async get<T = Record<string, unknown>>(entity: string, id: string): Promise<T | null> {
    const r = await this.db.records.get([entity, id]);
    return r && !r.deleted ? (r.data as T) : null;
  }

  pendingCount(): Promise<number> {
    return this.db.outbox.count();
  }

  // ---------------------------------------------------------------- sync

  /** Push then pull. Calls during a sync coalesce into one more pass. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.push();
          await this.pull();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async push(): Promise<void> {
    for (;;) {
      const batch = await this.db.outbox.orderBy('createdAt').limit(500).toArray();
      if (!batch.length) return;
      const res = await this.transport.push(batch.map(({ createdAt: _c, ...m }) => m));
      this.hlc.receive(res.hlc);
      const done = new Set(res.applied.map((a) => a.mutationId));
      const byId = new Map(batch.map((m) => [m.mutationId, m]));
      for (const r of res.rejected) {
        done.add(r.mutationId);
        const m = byId.get(r.mutationId);
        if (m)
          for (const l of this.rejectionListeners)
            l({ mutationId: r.mutationId, entity: m.entity, entityId: m.entityId, reason: r.reason });
      }
      await this.db.outbox.bulkDelete([...done]);
      if (done.size < batch.length) return; // the server kept some back: next sync
    }
  }

  /** Pull only (exposed for tests and for a socket nudge when nothing is pending). */
  async pull(): Promise<void> {
    let more = true;
    let any = false;
    while (more) {
      const cursor = (await this.db.meta.get('cursor'))?.value ?? null;
      const res = await this.transport.pull(cursor);
      await this.db.transaction('rw', this.db.records, this.db.outbox, this.db.meta, async () => {
        for (const c of res.changes) await this.apply(c);
        await this.db.meta.put({ key: 'cursor', value: res.cursor });
      });
      any ||= res.changes.length > 0;
      more = res.hasMore;
    }
    if (any) this.changed();
  }

  private async apply(c: Change): Promise<void> {
    if (c.op === 'delete' || !c.data) {
      await this.db.records.put({
        entity: c.entity,
        id: c.entityId,
        data: { id: c.entityId },
        deleted: true,
        updatedAt: Date.now(),
      });
      return;
    }
    // the server's copy, then this device's unacknowledged edits on top
    const pending = (
      await this.db.outbox.where('[entity+entityId]').equals([c.entity, c.entityId]).toArray()
    ).sort((a, b) => (a.hlc < b.hlc ? -1 : 1));
    const data: Record<string, unknown> = { ...c.data };
    let deleted = false;
    for (const p of pending) {
      if (p.op === 'delete') deleted = true;
      else Object.assign(data, p.fields);
    }
    await this.db.records.put({ entity: c.entity, id: c.entityId, data, deleted, updatedAt: Date.now() });
  }

  /** Sign-out on this device: forget everything local. */
  async wipe(): Promise<void> {
    await this.db.delete();
    await this.db.open();
    this.changed();
  }

  close(): void {
    this.db.close();
  }
}

export { uuidv7 };
