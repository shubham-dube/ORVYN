import 'fake-indexeddb/auto';
import type { Change, Mutation, PullResponse, PushResult } from '@orvyn/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { SyncClient, type Transport } from '../src/index';

/** Field-level last-writer-wins, as apps/api/src/modules/sync does it (same fake as the Dart client's tests). */
class FakeBackend {
  rows = new Map<string, Record<string, unknown>>();
  clocks = new Map<string, Record<string, string>>();
  log: Change[] = [];
  seen = new Set<string>();
  refused = new Set<string>();
  hlc = '000000000000000:00000:server';

  transport(): Transport {
    return {
      push: async (mutations: Mutation[]): Promise<PushResult> => {
        const applied: PushResult['applied'] = [];
        const rejected: PushResult['rejected'] = [];
        for (const m of mutations) {
          if (this.refused.has(m.entity)) {
            rejected.push({ mutationId: m.mutationId, reason: 'forbidden' });
            continue;
          }
          if (!this.seen.has(m.mutationId)) {
            this.seen.add(m.mutationId);
            this.apply(m);
          }
          applied.push({ mutationId: m.mutationId, seq: String(this.log.length) });
          if (m.hlc > this.hlc) this.hlc = m.hlc;
        }
        return { applied, rejected, hlc: this.hlc };
      },
      pull: async (cursor: string | null): Promise<PullResponse> => {
        const from = Number(cursor ?? 0);
        const page = this.log.slice(from, from + 2); // small pages exercise hasMore
        return {
          changes: page,
          cursor: String(from + page.length),
          hasMore: from + page.length < this.log.length,
        };
      },
    };
  }

  private apply(m: Mutation): void {
    const key = `${m.entity}/${m.entityId}`;
    if (m.op === 'delete') {
      this.log.push({
        seq: String(this.log.length + 1),
        entity: m.entity,
        entityId: m.entityId,
        op: 'delete',
        data: null,
      });
      return;
    }
    const row = this.rows.get(key) ?? { id: m.entityId };
    const c = this.clocks.get(key) ?? {};
    for (const [f, v] of Object.entries(m.fields)) {
      if ((c[f] ?? '') < m.hlc) {
        row[f] = v;
        c[f] = m.hlc;
      }
    }
    this.rows.set(key, row);
    this.clocks.set(key, c);
    this.log.push({
      seq: String(this.log.length + 1),
      entity: m.entity,
      entityId: m.entityId,
      op: 'upsert',
      data: { ...row },
    });
  }
}

let backend: FakeBackend;
let n = 0;
const device = (node: string, now?: () => number) =>
  new SyncClient(`test-${n++}`, backend.transport(), node, now);

beforeEach(() => {
  backend = new FakeBackend();
});

describe('sync client', () => {
  it('writes show instantly offline, then reach the server and other devices', async () => {
    const web = device('web');
    const ext = device('ext');
    const id = await web.upsert('today.task', { title: 'Milk', done: false });
    expect((await web.get<{ title: string }>('today.task', id))?.title).toBe('Milk');
    expect(await web.pendingCount()).toBe(1);
    await web.sync();
    expect(await web.pendingCount()).toBe(0);
    await ext.sync();
    expect(await ext.get('today.task', id)).toMatchObject({ title: 'Milk' });
  });

  it('concurrent edits merge per field', async () => {
    let t = 1000;
    const a = device('a', () => t);
    const b = device('b', () => t);
    const id = await a.upsert('today.task', { title: 'Milk', done: false });
    await a.sync();
    await b.sync();
    t = 2000;
    await a.upsert('today.task', { title: 'Oat milk' }, id);
    t = 3000;
    await b.upsert('today.task', { done: true }, id);
    await b.sync();
    await a.sync();
    await b.sync();
    for (const d of [a, b])
      expect(await d.get('today.task', id)).toMatchObject({ title: 'Oat milk', done: true });
  });

  it('a pull never hides an edit that has not been pushed yet', async () => {
    const a = device('a');
    const b = device('b');
    const id = await b.upsert('today.task', { title: 'A', body: 'x' });
    await b.sync();
    await a.sync();
    await a.upsert('today.task', { title: 'B' }, id);
    await b.upsert('today.task', { body: 'y' }, id);
    await b.sync();
    await a.pull();
    expect(await a.get('today.task', id)).toMatchObject({ title: 'B', body: 'y' });
    expect(await a.pendingCount()).toBe(1);
    await a.sync();
    expect(await a.get('today.task', id)).toMatchObject({ title: 'B', body: 'y' });
  });

  it('deletes sync; pushes are idempotent; rejections are reported and leave the outbox', async () => {
    const a = device('a');
    const b = device('b');
    const id = await a.upsert('today.task', { title: 'Temp' });
    await a.sync();
    await b.sync();
    await b.remove('today.task', id);
    expect(await b.get('today.task', id)).toBeNull();
    await b.sync();
    await a.sync();
    expect(await a.get('today.task', id)).toBeNull();
    expect(backend.seen.size).toBe(2);

    backend.refused.add('vault.item');
    const reasons: string[] = [];
    a.onRejected((r) => reasons.push(r.reason));
    await a.upsert('vault.item', { x: 1 });
    await a.sync();
    expect(reasons).toEqual(['forbidden']);
    expect(await a.pendingCount()).toBe(0);
  });

  it('lists live rows, notifies on change, and wipes on sign-out', async () => {
    const a = device('a');
    let changes = 0;
    a.onChange(() => changes++);
    const one = await a.upsert('today.task', { title: 'one' });
    await a.upsert('today.task', { title: 'two' });
    await a.remove('today.task', one);
    expect((await a.list<{ title: string }>('today.task')).map((t) => t.title)).toEqual(['two']);
    expect(changes).toBe(3);
    await a.wipe();
    expect(await a.list('today.task')).toEqual([]);
    expect(await a.pendingCount()).toBe(0);
  });
});
