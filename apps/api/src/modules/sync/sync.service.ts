import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject, Injectable } from '@nestjs/common';
import { compareHlc, Hlc, type Mutation, type PullResponse, type PushResult } from '@orvyn/contracts';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { type AuthContext } from '../auth/auth.decorators';
import { RealtimeService } from '../realtime/realtime.service';
import { type SyncEntity, SyncRegistry, type Tx } from './sync.registry';
import { newId } from '../../db/ids';
import { Rejected } from './sync.registry';
import { changeLog, syncMeta } from './sync.schema';

const PAGE = 500;

/** Emitted after each accepted change; modules react (e.g. Today reschedules reminders). */
/** The device id recorded for changes the server makes on its own (roll-forward, calendar sync). */
export const SERVER_DEVICE = '00000000-0000-0000-0000-000000000000';

export interface SyncApplied {
  ownerId: string;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
}

@Injectable()
export class SyncService {
  private readonly clock = new Hlc('server');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: SyncRegistry,
    private readonly realtime: RealtimeService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * A change made by the server on the person's behalf (a notification action like "Done"): stamped with the
   * server's clock so it merges per field like any device's edit, and announced to every device, including the
   * one that asked for it.
   */
  async pushAsServer(
    auth: AuthContext,
    changes: Pick<Mutation, 'entity' | 'entityId' | 'op' | 'fields'>[],
  ): Promise<PushResult> {
    const mutations = changes.map((c) => ({ ...c, mutationId: newId(), hlc: this.clock.tick() }));
    return this.push({ ...auth, deviceId: auth.deviceId }, mutations, { notifyAll: true });
  }

  async push(
    auth: AuthContext,
    mutations: Mutation[],
    opts: { notifyAll?: boolean } = {},
  ): Promise<PushResult> {
    const result: PushResult = { applied: [], rejected: [], hlc: '' };
    let last: bigint | null = null;
    for (const m of mutations) {
      try {
        const seq = await this.apply(auth, m);
        result.applied.push({ mutationId: m.mutationId, seq: seq.toString() });
        await this.events.emitAsync('sync.applied', {
          ownerId: auth.userId,
          entity: m.entity,
          entityId: m.entityId,
          op: m.op,
        } satisfies SyncApplied);
        if (last === null || seq > last) last = seq;
      } catch (e) {
        if (!(e instanceof Rejected)) throw e;
        result.rejected.push({ mutationId: m.mutationId, reason: e.message });
      }
    }
    result.hlc = this.clock.tick();
    if (last !== null)
      await this.realtime.toUser(
        auth.userId,
        { type: 'sync.changed', seq: last.toString() },
        opts.notifyAll ? undefined : auth.deviceId,
      );
    return result;
  }

  private async apply(auth: AuthContext, m: Mutation): Promise<bigint> {
    const entity = this.registry.get(m.entity);
    if (!entity) throw new Rejected('unknown_entity');
    if (!auth.entitlements.has(entity.entitlement)) throw new Rejected('feature_not_enabled');
    try {
      this.clock.receive(m.hlc);
    } catch {
      throw new Rejected('clock_skew');
    }

    return this.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ seq: changeLog.seq })
        .from(changeLog)
        .where(eq(changeLog.mutationId, m.mutationId));
      if (dup) return dup.seq; // idempotent retry

      const [meta] = await tx
        .select()
        .from(syncMeta)
        .where(and(eq(syncMeta.entity, m.entity), eq(syncMeta.entityId, m.entityId)))
        .for('update');
      if (meta && meta.ownerId !== auth.userId) throw new Rejected('not_found'); // ids are global; ownership is not
      const clocks = { ...(meta?.fieldHlcs ?? {}) };

      if (m.op === 'delete') {
        const newest = Object.values(clocks).reduce((a, b) => (compareHlc(a, b) >= 0 ? a : b), '');
        if (newest && compareHlc(m.hlc, newest) < 0) return meta!.lastSeq; // a later edit wins over this delete
        if (meta?.deletedHlc) return meta.lastSeq;
        if (meta) await entity.remove(tx, auth.userId, m.entityId);
        return this.record(tx, auth, m, entity, null, clocks, m.hlc, !!meta);
      }

      if (meta?.deletedHlc && compareHlc(m.hlc, meta.deletedHlc) < 0) return meta.lastSeq; // edit of a deleted object
      const accepted: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(m.fields)) {
        const prev = clocks[field];
        if (!prev || compareHlc(m.hlc, prev) > 0) {
          accepted[field] = value;
          clocks[field] = m.hlc;
        }
      }
      const isNew = !meta || !!meta.deletedHlc;
      const shape = isNew ? entity.schema.strict() : entity.schema.partial().strict();
      const parsed = shape.safeParse(accepted);
      if (!parsed.success)
        throw new Rejected(
          `invalid: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
        );
      if (!Object.keys(accepted).length && meta) return meta.lastSeq; // everything was stale
      await entity.write(tx, auth.userId, m.entityId, parsed.data, isNew);
      const row = await entity.load(tx, auth.userId, m.entityId);
      return this.record(
        tx,
        auth,
        m,
        entity,
        row,
        clocks,
        meta?.deletedHlc && !isNew ? meta.deletedHlc : null,
        !!meta,
      );
    });
  }

  private async record(
    tx: Tx,
    auth: AuthContext,
    m: Mutation,
    entity: SyncEntity,
    row: Record<string, unknown> | null,
    clocks: Record<string, string>,
    deletedHlc: string | null,
    exists: boolean,
  ): Promise<bigint> {
    const data = row ? (entity.toClient ? entity.toClient(row) : row) : null;
    const [log] = await tx
      .insert(changeLog)
      .values({
        ownerId: auth.userId,
        entity: m.entity,
        entityId: m.entityId,
        op: m.op,
        data: data ? (JSON.parse(JSON.stringify(data)) as Record<string, unknown>) : null,
        hlc: m.hlc,
        deviceId: auth.deviceId,
        mutationId: m.mutationId,
      })
      .returning({ seq: changeLog.seq });
    const seq = log!.seq;
    const values = {
      ownerId: auth.userId,
      fieldHlcs: clocks,
      deletedHlc: m.op === 'delete' ? m.hlc : deletedHlc,
      lastSeq: seq,
    };
    if (exists)
      await tx
        .update(syncMeta)
        .set(values)
        .where(and(eq(syncMeta.entity, m.entity), eq(syncMeta.entityId, m.entityId)));
    else await tx.insert(syncMeta).values({ entity: m.entity, entityId: m.entityId, ...values });
    return seq;
  }

  async pull(auth: AuthContext, cursor: string | undefined): Promise<PullResponse> {
    const names = this.registry.namesFor(auth.entitlements as Set<string>);
    const after = BigInt(cursor && /^\d+$/.test(cursor) ? cursor : '0');
    if (!names.length) return { changes: [], cursor: after.toString(), hasMore: false };
    const rows = await this.db
      .select()
      .from(changeLog)
      .where(
        and(eq(changeLog.ownerId, auth.userId), gt(changeLog.seq, after), inArray(changeLog.entity, names)),
      )
      .orderBy(asc(changeLog.seq))
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return {
      changes: page.map((r) => ({
        seq: r.seq.toString(),
        entity: r.entity,
        entityId: r.entityId,
        op: r.op,
        data: r.data ?? null,
      })),
      cursor: (page.at(-1)?.seq ?? after).toString(),
      hasMore: rows.length > PAGE,
    };
  }
}
