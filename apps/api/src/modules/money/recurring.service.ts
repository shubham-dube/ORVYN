import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { formatMoney, MONEY_RECURRING, MONEY_TRANSACTION } from '@orvyn/contracts';
import { instantAt } from '@orvyn/today-parse';
import { occurrences } from '@orvyn/today-plan';
import { Queue, Worker } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { NotifyService } from '../notify/notify.service';
import { SERVER_DEVICE, serverOrigin, type SyncApplied, SyncService } from '../sync/sync.service';
import { moneyRecurring } from './money.schema';

const QUEUE = 'money';
/** A device that was off for weeks catches up on at most this many days (older occurrences are skipped, not invented). */
const CATCH_UP_DAYS = 62;

const ymd = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
const addDay = (s: string, n: number) =>
  new Date(Date.parse(`${s}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Scheduled money (spec 0006): once an hour, and right when one is saved, every active schedule adds what has come due
 * since it last ran — as a transaction marked new (unique per schedule and day, so a retry or a second worker can't
 * double it), or as a reminder when the person wants to enter the real amount themselves.
 */
@Injectable()
export class RecurringService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('money.recurring');
  private queue!: Queue<{ kind: 'tick' }>;
  private worker?: Worker<{ kind: 'tick' }>;
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly sync: SyncService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    });
    if (this.env.PROCESS_ROLE !== 'api') {
      await this.queue.upsertJobScheduler(
        'money-recurring',
        { every: 3_600_000 },
        { name: 'tick', data: { kind: 'tick' } },
      );
      this.worker = new Worker(QUEUE, () => this.run(), { connection, concurrency: 1 });
      this.worker.on('failed', (j, e) => this.log.warn(`job ${j?.id} failed: ${e.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (e.entity !== MONEY_RECURRING || e.op !== 'upsert' || serverOrigin.getStore()) return;
    try {
      await this.run(e.ownerId, e.entityId);
    } catch (err) {
      this.log.warn(`run failed: ${(err as Error).message}`);
    }
  }

  /** Handle everything due for one schedule, or for all of them. Returns how many were added. */
  async run(ownerId?: string, id?: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(moneyRecurring)
      .where(
        and(
          isNull(moneyRecurring.deletedAt),
          eq(moneyRecurring.paused, false),
          ...(ownerId ? [eq(moneyRecurring.ownerId, ownerId)] : []),
          ...(id ? [eq(moneyRecurring.id, id)] : []),
        ),
      );
    let added = 0;
    for (const r of rows) added += await this.one(r);
    return added;
  }

  private async one(r: typeof moneyRecurring.$inferSelect): Promise<number> {
    const now = new Date(this.now());
    const today = ymd(now, r.timeZone);
    if (r.endDate && r.endDate < r.startDate) return 0;
    // from the day after the last run (or the start), never further back than the catch-up window
    const earliest = addDay(today, -CATCH_UP_DAYS);
    let from = r.lastRunOn ? addDay(r.lastRunOn, 1) : r.startDate;
    if (from < earliest) from = earliest;
    if (from < r.startDate) from = r.startDate;
    const to = r.endDate && r.endDate < today ? r.endDate : today;
    if (from > to) return 0;
    let days: string[];
    try {
      days = occurrences(
        r.rrule,
        { date: r.startDate, timeZone: r.timeZone },
        new Date(`${from}T00:00:00Z`),
        new Date(`${to}T00:00:00Z`),
      ).map((o) => o.date!);
    } catch {
      this.log.warn(`schedule ${r.id} has a rule that can't be read`);
      return 0;
    }
    const p = await this.access.principal(r.ownerId);
    if (!p) return 0;
    const auth = { userId: r.ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements };
    let added = 0;
    for (const day of days) {
      const [h, m] = r.time.split(':').map(Number) as [number, number];
      const [Y, M, D] = day.split('-').map(Number) as [number, number, number];
      const at = instantAt(Y, M, D, h, m, r.timeZone);
      if (r.mode === 'add') {
        const res = await this.sync.pushAsServer(auth, [
          {
            entity: MONEY_TRANSACTION,
            entityId: crypto.randomUUID(),
            op: 'upsert',
            fields: {
              amountMinor: r.amountMinor,
              currency: r.currency,
              direction: r.direction,
              occurredAt: at.toISOString(),
              merchant: r.merchant || r.title,
              categoryId: r.categoryId,
              accountId: r.accountId,
              note: r.note,
              source: 'recurring',
              dedupeKey: `rec:${r.id}:${day}`, // unique per schedule and day: never twice
              reviewed: false,
            },
          },
        ]);
        if (res.applied.length) added++;
      } else if (day === today) {
        await this.notify.send({
          userId: r.ownerId,
          module: 'money',
          kind: 'recurring.due',
          title: `${r.title} · ${formatMoney(r.amountMinor, r.currency)} due`,
          body:
            r.direction === 'credit'
              ? 'Add it to Money when it arrives.'
              : 'Add it to Money once you’ve paid.',
          url: '/money',
          dedupeKey: `money:rec:${r.id}:${day}`,
        });
      }
    }
    await this.sync.pushAsServer(auth, [
      { entity: MONEY_RECURRING, entityId: r.id, op: 'upsert', fields: { lastRunOn: to } },
    ]);
    return added;
  }
}
