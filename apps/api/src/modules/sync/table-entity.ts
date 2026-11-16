import { and, eq, isNull, sql } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { type ModuleKey } from '@orvyn/contracts';
import { type ZodObject, type ZodRawShape } from 'zod';
import { type SyncEntity, type Tx } from './sync.registry';

type Row = Record<string, unknown>;
type OwnedTable = PgTable & { id: PgColumn; ownerId: PgColumn; deletedAt: PgColumn };

/**
 * A sync entity backed by one owner-scoped table whose column keys equal the synced field names. Timestamp
 * columns are listed so ISO strings from clients become Dates (and back). Every query filters by owner.
 */
export function tableEntity(o: {
  name: string;
  entitlement: ModuleKey;
  table: OwnedTable;
  schema: ZodObject<ZodRawShape>;
  timestamps?: readonly string[];
  /** cross-row checks (e.g. a referenced project must be yours); throw Rejected to refuse */
  validate?: (tx: Tx, ownerId: string, fields: Row) => Promise<void>;
}): SyncEntity {
  const fields = Object.keys(o.schema.shape);
  const tsFields = new Set(o.timestamps ?? []);
  const toDb = (f: Row): Row =>
    Object.fromEntries(
      Object.entries(f).map(([k, v]) => [k, tsFields.has(k) && typeof v === 'string' ? new Date(v) : v]),
    );
  const toClient = (r: Row): Row => {
    const out: Row = { id: r.id };
    for (const k of fields) {
      const v = r[k];
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    return out;
  };
  const t = o.table;
  return {
    name: o.name,
    entitlement: o.entitlement,
    schema: o.schema,
    async load(tx, ownerId, id) {
      const [r] = await tx
        .select()
        .from(t)
        .where(and(eq(t.id, id), eq(t.ownerId, ownerId), isNull(t.deletedAt)));
      return r ? toClient(r as Row) : null;
    },
    async write(tx, ownerId, id, f, isNew) {
      await o.validate?.(tx, ownerId, f);
      const values = toDb(f);
      if (isNew) {
        // a re-created (previously deleted) id is revived, never taken over from another owner
        const res = await tx
          .insert(t)
          .values({ id, ownerId, ...values } as never)
          .onConflictDoUpdate({
            target: t.id,
            set: { ...values, deletedAt: null } as never,
            setWhere: eq(t.ownerId, ownerId),
          })
          .returning({ id: t.id });
        if (!res.length) throw new Error('id belongs to someone else');
      } else {
        await tx
          .update(t)
          .set(values as never)
          .where(and(eq(t.id, id), eq(t.ownerId, ownerId)));
      }
    },
    async remove(tx, ownerId, id) {
      await tx
        .update(t)
        .set({ deletedAt: sql`now()` } as never)
        .where(and(eq(t.id, id), eq(t.ownerId, ownerId)));
    },
  };
}
