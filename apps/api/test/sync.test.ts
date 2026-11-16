import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SyncRegistry } from '../src/modules/sync/sync.registry';
import { call, type Harness, openSocket, OWNER, signIn, sleep, startApp, waitFor } from './harness';

const notes = pgTable('test_notes', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  done: boolean('done').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

@Injectable()
class NotesEntity implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit() {
    this.registry.register({
      name: 'test.note',
      entitlement: 'today',
      schema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(5000).default(''),
        done: z.boolean().default(false),
      }),
      load: async (tx, ownerId, id) => {
        const [r] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId), isNull(notes.deletedAt)));
        return r ? { id: r.id, title: r.title, body: r.body, done: r.done } : null;
      },
      write: async (tx, ownerId, id, f, isNew) => {
        if (isNew) {
          await tx
            .insert(notes)
            .values({
              id,
              ownerId,
              title: String(f.title),
              body: String(f.body ?? ''),
              done: Boolean(f.done ?? false),
            })
            .onConflictDoUpdate({
              target: notes.id,
              set: {
                title: String(f.title),
                body: String(f.body ?? ''),
                done: Boolean(f.done ?? false),
                deletedAt: null,
              },
            });
        } else
          await tx
            .update(notes)
            .set(f as Record<string, unknown>)
            .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)));
      },
      remove: async (tx, ownerId, id) => {
        await tx
          .update(notes)
          .set({ deletedAt: sql`now()` })
          .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)));
      },
    });
  }
}
@Module({ providers: [NotesEntity] })
class NotesModule {}

let h: Harness;
let phone: SessionResponse;
let laptop: SessionResponse;
let friend: SessionResponse;
const clockA = new Hlc('phone');
const clockB = new Hlc('laptop');

const push = (s: SessionResponse, mutations: unknown[]) =>
  call<any>(h, 'POST', '/sync/push', { token: s.accessToken, body: { mutations } });
const pull = (s: SessionResponse, cursor = '0') =>
  call<any>(h, 'GET', `/sync/pull?cursor=${cursor}`, { token: s.accessToken });
const upsert = (entityId: string, fields: Record<string, unknown>, hlc: string, mutationId = v7()) => ({
  mutationId,
  entity: 'test.note',
  entityId,
  op: 'upsert',
  fields,
  hlc,
});

beforeAll(async () => {
  h = await startApp([NotesModule], {}, [], async (env) => {
    const s = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined });
    await s.unsafe(
      'create table test_notes (id uuid primary key, owner_id uuid not null, title text not null, body text not null, done boolean not null, deleted_at timestamptz)',
    );
    await s.end();
  });
  phone = (await signIn(h, OWNER, { platform: 'android' })).body;
  laptop = (await signIn(h, OWNER, { platform: 'windows' })).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: phone.accessToken,
    body: { entitlements: ['today'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(async () => h.close());

describe('sync', () => {
  const id = v7();

  it('creates on one device and the change reaches the others', async () => {
    const ws = await openSocket(h, laptop.accessToken);
    const r = await push(phone, [upsert(id, { title: 'Pay rent' }, clockA.tick())]);
    expect(r.body.applied).toHaveLength(1);
    await waitFor(() => ws.messages.some((m) => m.type === 'sync.changed'));
    const p = await pull(laptop);
    expect(p.body.changes.at(-1)).toMatchObject({
      entity: 'test.note',
      entityId: id,
      op: 'upsert',
      data: { title: 'Pay rent', body: '', done: false },
    });
    ws.close();
  });

  it('does not ping the device that made the change', async () => {
    const ws = await openSocket(h, phone.accessToken);
    await push(phone, [upsert(id, { body: 'before the 5th' }, clockA.tick())]);
    await sleep(300);
    expect(ws.messages.filter((m) => m.type === 'sync.changed')).toHaveLength(0);
    ws.close();
  });

  it('is idempotent: retrying a mutation does not apply it twice', async () => {
    const m = upsert(id, { body: 'retry me' }, clockA.tick());
    const a = await push(phone, [m]);
    const b = await push(phone, [m]);
    expect(b.body.applied[0].seq).toBe(a.body.applied[0].seq);
  });

  it('merges concurrent edits field by field; the newer write wins per field', async () => {
    const older = clockB.tick(); // laptop edits first (offline)…
    const newer = clockA.tick(); // …phone edits later
    await push(phone, [upsert(id, { title: 'Pay rent (₹18,000)' }, newer)]);
    await push(laptop, [upsert(id, { title: 'Rent', done: true }, older)]); // arrives late
    const all = (await pull(phone)).body.changes;
    expect(all.at(-1).data).toMatchObject({ title: 'Pay rent (₹18,000)', done: true }); // title kept, done merged in
  });

  it('a delete beats older edits, and stale edits do not resurrect it', async () => {
    const del = {
      mutationId: v7(),
      entity: 'test.note',
      entityId: id,
      op: 'delete',
      fields: {},
      hlc: clockA.tick(),
    };
    expect((await push(phone, [del])).body.applied).toHaveLength(1);
    const stale = '000000000000001:00000:laptop';
    await push(laptop, [upsert(id, { title: 'zombie' }, stale)]);
    const last = (await pull(phone)).body.changes.at(-1);
    expect(last).toMatchObject({ entityId: id, op: 'delete', data: null });
  });

  it('validates fields: unknown or missing required fields are rejected', async () => {
    const r = await push(phone, [
      upsert(v7(), { body: 'no title' }, clockA.tick()),
      upsert(v7(), { title: 'x', secret: 1 }, clockA.tick()),
    ]);
    expect(r.body.applied).toHaveLength(0);
    expect(r.body.rejected).toHaveLength(2);
  });

  it('rejects clocks far in the future', async () => {
    const future = `${String(Date.now() + 3_600_000).padStart(15, '0')}:00000:phone`;
    const r = await push(phone, [upsert(v7(), { title: 'from the future' }, future)]);
    expect(r.body.rejected[0].reason).toBe('clock_skew');
  });
});

describe('sync isolation', () => {
  it("never shows or changes another person's data", async () => {
    const mine = v7();
    await push(phone, [upsert(mine, { title: 'private' }, clockA.tick())]);
    const theirs = await pull(friend);
    expect(theirs.body.changes.every((c: any) => c.entityId !== mine)).toBe(true);
    const hijack = await push(friend, [upsert(mine, { title: 'hacked' }, new Hlc('f').tick())]);
    expect(hijack.body.rejected[0].reason).toBe('not_found');
  });

  it('requires the feature switch', async () => {
    await call(h, 'PUT', `/admin/users/${friend.user.id}/entitlements`, {
      token: phone.accessToken,
      body: { entitlements: [] },
    });
    const r = await push(friend, [upsert(v7(), { title: 'x' }, new Hlc('f').tick())]);
    expect(r.body.rejected[0].reason).toBe('feature_not_enabled');
    expect((await pull(friend)).body.changes).toHaveLength(0);
  });
});

describe('realtime security', () => {
  it('revoking a device closes its socket', async () => {
    const tablet = (await signIn(h, OWNER, { platform: 'android' })).body;
    const ws = await openSocket(h, tablet.accessToken);
    await call(h, 'DELETE', `/me/devices/${tablet.deviceId}`, { token: phone.accessToken });
    await waitFor(() => ws.closed() !== null);
    expect(ws.messages.some((m) => m.type === 'session.revoked')).toBe(true);
    expect(ws.closed()).toBe(4401);
  });

  it('rejects sockets without a valid token', async () => {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(h.url.replace('http', 'ws') + '/ws');
    const code = await new Promise<number>((resolve) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'nope' })));
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(4401);
  });
});
