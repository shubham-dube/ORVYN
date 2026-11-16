import { Injectable } from '@nestjs/common';
import { type ModuleKey } from '@orvyn/contracts';
import { type ZodObject, type ZodRawShape } from 'zod';
import { type Db } from '../../db/db.module';

/** Transaction handle (same API as Db). */
export type Tx = Db;

/**
 * What a module provides to make one of its tables syncable. The engine handles ordering, idempotency,
 * merge clocks, ownership and the change log; the module only reads and writes its own table.
 */
export interface SyncEntity<Row extends Record<string, unknown> = Record<string, unknown>> {
  /** e.g. "today.task" */
  name: string;
  /** Feature switch that guards it (ADR-0005). */
  entitlement: ModuleKey;
  /** Writable fields; unknown fields are rejected. Required fields must be present when the object is created. */
  schema: ZodObject<ZodRawShape>;
  /** Current row (owner-scoped), or null. */
  load(tx: Tx, ownerId: string, id: string): Promise<Row | null>;
  /** Create (isNew) or update with already-merged fields. */
  write(tx: Tx, ownerId: string, id: string, fields: Partial<Row>, isNew: boolean): Promise<void>;
  /** Soft delete. */
  remove(tx: Tx, ownerId: string, id: string): Promise<void>;
  /** Shape sent to clients (defaults to the row). */
  toClient?(row: Row): Record<string, unknown>;
}

@Injectable()
export class SyncRegistry {
  private readonly entities = new Map<string, SyncEntity>();

  register<R extends Record<string, unknown>>(e: SyncEntity<R>): void {
    if (this.entities.has(e.name)) throw new Error(`sync entity ${e.name} registered twice`);
    this.entities.set(e.name, e as unknown as SyncEntity);
  }

  get(name: string): SyncEntity | undefined {
    return this.entities.get(name);
  }

  namesFor(entitlements: Set<string>): string[] {
    return [...this.entities.values()].filter((e) => entitlements.has(e.entitlement)).map((e) => e.name);
  }
}
