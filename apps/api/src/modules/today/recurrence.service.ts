import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TODAY_TASK } from '@orvyn/contracts';
import { nextOccurrence } from '@orvyn/today-plan';
import { wallIn } from '@orvyn/today-parse';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { SERVER_DEVICE, type SyncApplied, SyncService } from '../sync/sync.service';
import { todaySettings, todayTasks } from './today.schema';

const day = (d: Date, tz: string) => {
  const w = wallIn(d, tz);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
};

/**
 * Repeating tasks roll forward (spec 0002 AC4): when one is ticked off — on any device, offline or from a
 * notification — the server moves it to its next occurrence (never one already past) and remembers when it was
 * done. Done once here so every device agrees. A repeat that has ended (COUNT/UNTIL) simply stays done.
 */
@Injectable()
export class RecurrenceService {
  private readonly log = new Logger('today.recurrence');
  /** tests set this */
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: SyncService,
    private readonly access: AccessService,
  ) {}

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (e.entity !== TODAY_TASK || e.op !== 'upsert') return;
    try {
      await this.roll(e.ownerId, e.entityId);
    } catch (err) {
      this.log.warn(`roll forward failed: ${(err as Error).message}`);
    }
  }

  /** Returns the fields written, or null if nothing needed doing. */
  async roll(ownerId: string, taskId: string): Promise<Record<string, unknown> | null> {
    const [t] = await this.db
      .select()
      .from(todayTasks)
      .where(and(eq(todayTasks.id, taskId), eq(todayTasks.ownerId, ownerId), isNull(todayTasks.deletedAt)));
    if (!t?.rrule || !t.completedAt) return null;
    const [s] = await this.db.select().from(todaySettings).where(eq(todaySettings.ownerId, ownerId));
    const tz = s?.timeZone ?? t.timeZone;
    const now = new Date(this.now());
    const moment = t.dueAt ?? t.scheduledStart;
    const current = moment
      ? { at: moment.toISOString(), timeZone: tz }
      : { date: t.dueDate ?? day(t.completedAt, tz), timeZone: tz };
    const next = nextOccurrence(t.rrule, current, now);
    if (!next) return null; // the repeat has ended: it stays done

    const fields: Record<string, unknown> = { completedAt: null, lastDoneAt: t.completedAt.toISOString() };
    if (next.at) {
      const shift = Date.parse(next.at) - moment!.getTime();
      if (t.dueAt) fields.dueAt = new Date(t.dueAt.getTime() + shift).toISOString();
      if (t.scheduledStart)
        fields.scheduledStart = new Date(t.scheduledStart.getTime() + shift).toISOString();
    } else {
      fields.dueDate = next.date;
    }
    // a fresh start for the checklist each time round
    if (t.checklist.some((c) => c.done)) fields.checklist = t.checklist.map((c) => ({ ...c, done: false }));

    const p = await this.access.principal(ownerId);
    if (!p) return null;
    await this.sync.pushAsServer(
      { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements },
      [{ entity: TODAY_TASK, entityId: taskId, op: 'upsert', fields }],
    );
    return fields;
  }
}
