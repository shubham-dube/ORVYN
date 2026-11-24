import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  type ReminderDefaults,
  type ReminderWay,
  reminderPlan,
  waysOf,
  type CalEvent,
  TODAY_EVENT,
  TODAY_SETTINGS,
  TODAY_TASK,
  type TaskFields,
} from '@orvyn/contracts';
import { wallIn } from '@orvyn/today-parse';
import { expandEvents } from '@orvyn/today-plan';
import { Queue, Worker } from 'bullmq';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import Redis from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { type AuthContext } from '../auth/auth.decorators';
import { type NotifyAction, NotifyService } from '../notify/notify.service';
import { deliveryFor } from '../notify/ways';
import { type SyncApplied, SyncService } from '../sync/sync.service';
import { todayEvents, todaySettings, todayTasks } from './today.schema';

type Job =
  | {
      kind: 'remind';
      ownerId: string;
      taskId: string;
      momentMs: number;
      snoozed?: boolean;
      via?: ReminderWay[];
    }
  | { kind: 'digest'; ownerId: string }
  | { kind: 'event'; ownerId: string; eventId: string; startMs: number };

const QUEUE = 'today';
const ACTIONS = [
  { id: 'done', label: 'Done' },
  { id: 'snooze_10m', label: 'Snooze 10 min' },
  { id: 'later_today', label: 'Later today' },
  { id: 'tomorrow', label: 'Tomorrow' },
];
type Task = typeof todayTasks.$inferSelect;
type Settings = typeof todaySettings.$inferSelect;

/**
 * Reminders (spec 0002 M3) from the person's own settings (D17): nothing fires from defaults until they have saved
 * settings; a task's own reminders always fire. One live notification per task (dedupe) with Done / Snooze 10 min
 * / Later today / Tomorrow; date-only tasks go to a morning summary or a ping at the time they chose.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('today.reminders');
  private queue!: Queue<Job>;
  private worker?: Worker<Job>;
  private redis!: Redis;
  /** tests set this to see time move */
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly notify: NotifyService,
    private readonly sync: SyncService,
    private readonly access: AccessService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    const connection = { url: this.env.REDIS_URL };
    this.redis = new Redis(this.env.REDIS_URL);
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 2000,
      },
    });
    if (this.env.PROCESS_ROLE !== 'api') {
      this.worker = new Worker<Job>(QUEUE, (job) => this.process(job.data), { connection, concurrency: 8 });
      this.worker.on('failed', (job, err) => this.log.warn(`job ${job?.id} failed: ${err.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redis?.quit();
  }

  // ------------------------------------------------------------------ keeping the schedule current

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    try {
      if (e.entity === TODAY_TASK) {
        await this.scheduleTask(e.ownerId, e.entityId);
        // done (or gone) on another device: its reminder stops everywhere, including a repeating hard one
        const t = await this.task(e.ownerId, e.entityId);
        if (!t || t.completedAt || e.op === 'delete')
          await this.notify.dismissByKey(e.ownerId, `today:task:${e.entityId}`);
      }
      if (e.entity === TODAY_SETTINGS) await this.scheduleOwner(e.ownerId);
      if (e.entity === TODAY_EVENT) {
        const series = await this.scheduleEvent(e.ownerId, e.entityId);
        // a changed or cancelled occurrence also changes what its series should remind about
        if (series) await this.scheduleEvent(e.ownerId, series);
      }
    } catch (err) {
      this.log.warn(`schedule failed: ${(err as Error).message}`);
    }
  }

  private async settings(ownerId: string): Promise<Settings | null> {
    const [s] = await this.db.select().from(todaySettings).where(eq(todaySettings.ownerId, ownerId));
    return s ?? null;
  }

  private async task(ownerId: string, id: string): Promise<Task | null> {
    const [t] = await this.db
      .select()
      .from(todayTasks)
      .where(and(eq(todayTasks.id, id), eq(todayTasks.ownerId, ownerId), isNull(todayTasks.deletedAt)));
    return t ?? null;
  }

  /** Replace a task's pending reminders with the ones its current state calls for. */
  async scheduleTask(ownerId: string, taskId: string, settings?: Settings | null): Promise<number[]> {
    const key = `today:rem:${taskId}`;
    for (const id of await this.redis.smembers(key))
      await (await this.queue.getJob(id))?.remove().catch(() => undefined);
    await this.redis.del(key);
    const t = await this.task(ownerId, taskId);
    if (!t || t.completedAt) return [];
    const moment = t.dueAt ?? t.scheduledStart;
    if (!moment) return []; // date-only tasks: the summary / ping handles them
    const s = settings === undefined ? await this.settings(ownerId) : settings;
    // until the person saves settings, only a task's own reminders count (D17: nothing assumed)
    const defaults: ReminderDefaults = s
      ? (s.reminders as ReminderDefaults)
      : { timed: [], dateOnly: { mode: 'none' }, overdueInDigest: false };
    const plan = reminderPlan(
      {
        reminders: t.reminders as TaskFields['reminders'],
        dueAt: t.dueAt?.toISOString() ?? null,
        scheduledStart: t.scheduledStart?.toISOString() ?? null,
        dueDate: t.dueDate,
      },
      defaults,
    );
    // when each fires and by which ways (two reminders at the same minute by different ways are both kept)
    const fires = new Map<string, { at: number; via: ReminderWay[] }>();
    for (const p of plan) {
      const at = p.minutes !== undefined ? moment.getTime() - p.minutes * 60_000 : new Date(p.at!).getTime();
      if (at <= this.now() - 60_000) continue;
      fires.set(`${at}-${[...p.via].sort().join('+')}`, { at, via: p.via });
    }
    for (const [k, f] of fires) {
      const jobId = `rem-${taskId}-${k}-${moment.getTime()}`;
      await this.queue.add(
        'remind',
        { kind: 'remind', ownerId, taskId, momentMs: moment.getTime(), via: f.via },
        { jobId, delay: Math.max(0, f.at - this.now()) },
      );
      await this.redis.sadd(key, jobId);
    }
    return [...new Set([...fires.values()].map((f) => f.at))].sort((a, b) => a - b);
  }

  /** Settings changed: the summary moves, and every open timed task is rescheduled with the new defaults. */
  async scheduleOwner(ownerId: string): Promise<void> {
    const s = await this.settings(ownerId);
    const id = `digest-${ownerId}`;
    const d = (s?.reminders as ReminderDefaults | undefined)?.dateOnly;
    if (s && d && d.mode !== 'none') {
      const [h, m] = d.at.split(':').map(Number);
      await this.queue.upsertJobScheduler(
        id,
        { pattern: `${m} ${h} * * *`, tz: s.timeZone },
        { name: 'digest', data: { kind: 'digest', ownerId } },
      );
    } else {
      await this.queue.removeJobScheduler(id);
    }
    const open = await this.db
      .select({ id: todayTasks.id })
      .from(todayTasks)
      .where(
        and(eq(todayTasks.ownerId, ownerId), isNull(todayTasks.deletedAt), isNull(todayTasks.completedAt)),
      );
    for (const t of open) await this.scheduleTask(ownerId, t.id, s);
    const events = await this.db
      .select({ id: todayEvents.id })
      .from(todayEvents)
      .where(and(eq(todayEvents.ownerId, ownerId), isNull(todayEvents.deletedAt)));
    for (const e of events) await this.scheduleEvent(ownerId, e.id, s);
  }

  // ------------------------------------------------------------------ events (D17: the person's timed defaults)

  private async seriesRows(ownerId: string, eventId: string) {
    return this.db
      .select()
      .from(todayEvents)
      .where(
        and(
          eq(todayEvents.ownerId, ownerId),
          isNull(todayEvents.deletedAt),
          or(eq(todayEvents.id, eventId), eq(todayEvents.recurringEventId, eventId)),
        ),
      );
  }

  /** The next start of this event row (its next occurrence when it repeats), or null. */
  private async nextStart(ownerId: string, eventId: string, after: number): Promise<number | null> {
    const rows = await this.seriesRows(ownerId, eventId);
    const me = rows.find((r) => r.id === eventId);
    if (!me || me.allDay || me.cancelled || !me.start || !me.end) return null;
    const asEvent = (r: (typeof rows)[number]) =>
      ({ ...r, start: r.start?.toISOString() ?? null, end: r.end?.toISOString() ?? null }) as CalEvent;
    if (!me.rrule) return me.start.getTime() > after ? me.start.getTime() : null;
    const from = new Date(after);
    const horizon = new Date(after + 400 * 86_400_000);
    // overrides are their own rows (scheduled on their own); expanding with them skips the changed occurrences
    const next = expandEvents(rows.map(asEvent), from, horizon).find(
      (i) => i.eventId === eventId && Date.parse(i.start!) > after,
    );
    return next ? Date.parse(next.start!) : null;
  }

  /** Replace an event's pending reminder with the next one; returns its series id when it is an override. */
  async scheduleEvent(
    ownerId: string,
    eventId: string,
    settings?: Settings | null,
    /** only occurrences after this one (the one that just fired) */
    afterMs?: number,
  ): Promise<string | null> {
    const key = `today:erem:${eventId}`;
    for (const id of await this.redis.smembers(key))
      await (await this.queue.getJob(id))?.remove().catch(() => undefined);
    await this.redis.del(key);
    const [row] = await this.db
      .select({ recurringEventId: todayEvents.recurringEventId })
      .from(todayEvents)
      .where(and(eq(todayEvents.id, eventId), eq(todayEvents.ownerId, ownerId)));
    const s = settings === undefined ? await this.settings(ownerId) : settings;
    const leads = s ? (s.reminders as ReminderDefaults).timed : []; // nothing assumed before settings exist
    if (!leads.length) return row?.recurringEventId ?? null;
    // the first occurrence that still has a reminder ahead of it
    let start = await this.nextStart(ownerId, eventId, Math.max(this.now() - 60_000, afterMs ?? -Infinity));
    const maxLead = Math.max(...leads) * 60_000;
    while (start !== null && start - Math.min(...leads) * 60_000 <= this.now() - 60_000) {
      start = await this.nextStart(ownerId, eventId, start);
    }
    if (start !== null) {
      for (const m of new Set(leads)) {
        const at = start - m * 60_000;
        if (at <= this.now() - 60_000 || start - maxLead > this.now() + 400 * 86_400_000) continue;
        const jobId = `erem-${eventId}-${start}-${m}`;
        await this.queue.add(
          'remind',
          { kind: 'event', ownerId, eventId, startMs: start },
          { jobId, delay: Math.max(0, at - this.now()) },
        );
        await this.redis.sadd(key, jobId);
      }
    }
    return row?.recurringEventId ?? null;
  }

  async remindEvent(ownerId: string, eventId: string, startMs: number): Promise<void> {
    const [e] = await this.db
      .select()
      .from(todayEvents)
      .where(
        and(eq(todayEvents.id, eventId), eq(todayEvents.ownerId, ownerId), isNull(todayEvents.deletedAt)),
      );
    // still on, at that time? (moved, cancelled or deleted since → nothing)
    if (!e || (await this.nextStart(ownerId, eventId, startMs - 1)) !== startMs) return;
    const tz = (await this.settings(ownerId))?.timeZone ?? e.timeZone;
    const mins = Math.round((startMs - this.now()) / 60_000);
    const when =
      mins > 1
        ? `In ${mins >= 120 ? `${Math.round(mins / 60)} h` : `${mins} min`} · ${this.fmtTime(startMs, tz)}`
        : `Now · ${this.fmtTime(startMs, tz)}`;
    await this.notify.send({
      userId: ownerId,
      module: 'today',
      kind: 'reminder',
      type: 'today.event_reminder',
      own: true,
      title: e.title,
      body: e.location ? `${when} · ${e.location}` : when,
      url: '/today',
      dedupeKey: `today:event:${eventId}:${startMs}`,
      ref: `today.event:${eventId}`,
      ...deliveryFor(((await this.settings(ownerId))?.reminders as ReminderDefaults | undefined)?.via),
    });
    // the last lead for this occurrence has fired: line up the next occurrence
    const leads = ((await this.settings(ownerId))?.reminders as ReminderDefaults | undefined)?.timed ?? [];
    if (leads.length && startMs - Math.min(...leads) * 60_000 <= this.now() + 60_000) {
      await this.scheduleEvent(ownerId, eventId, undefined, startMs);
    }
  }

  // ------------------------------------------------------------------ firing

  async process(job: Job): Promise<void> {
    if (job.kind === 'remind')
      return this.remind(job.ownerId, job.taskId, job.momentMs, job.snoozed, job.via);
    if (job.kind === 'event') return this.remindEvent(job.ownerId, job.eventId, job.startMs);
    return this.digest(job.ownerId);
  }

  private fmtTime(ms: number, tz: string): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms);
  }

  /** `momentMs` 0 = a date-only task (a snooze from the summary/ping); anything else must still be its time. */
  async remind(
    ownerId: string,
    taskId: string,
    momentMs: number,
    snoozed = false,
    via?: ReminderWay[],
  ): Promise<void> {
    const t = await this.task(ownerId, taskId);
    const moment = t?.dueAt ?? t?.scheduledStart ?? null;
    if (!t || t.completedAt || (moment?.getTime() ?? 0) !== momentMs) return; // done, moved or deleted since
    const tz = (await this.settings(ownerId))?.timeZone ?? t.timeZone;
    const mins = Math.round((momentMs - this.now()) / 60_000);
    const when = !moment
      ? 'Snoozed reminder'
      : mins > 1
        ? `In ${mins >= 120 ? `${Math.round(mins / 60)} h` : `${mins} min`} · ${this.fmtTime(momentMs, tz)}`
        : `${snoozed && mins < -1 ? 'Was due' : 'Now'} · ${this.fmtTime(momentMs, tz)}`;
    await this.notify.send({
      userId: ownerId,
      module: 'today',
      kind: 'reminder',
      type: 'today.task_reminder',
      own: true,
      title: t.title,
      body: when,
      url: '/today',
      actions: ACTIONS,
      dedupeKey: `today:task:${taskId}`,
      ref: `today.task:${taskId}`,
      ...deliveryFor(via),
      priority:
        via && waysOf(via).some((w) => w === 'urgent' || w === 'alarm')
          ? 'urgent'
          : t.priority >= 3
            ? 'high'
            : 'normal',
    });
  }

  async digest(ownerId: string): Promise<void> {
    const s = await this.settings(ownerId);
    const d = (s?.reminders as ReminderDefaults | undefined)?.dateOnly;
    if (!s || !d || d.mode === 'none') return;
    const defaultsVia = (s.reminders as ReminderDefaults).dateOnlyVia;
    const w = wallIn(new Date(this.now()), s.timeZone);
    const today = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
    const overdue = (s.reminders as ReminderDefaults).overdueInDigest;
    const due = await this.db
      .select()
      .from(todayTasks)
      .where(
        and(
          eq(todayTasks.ownerId, ownerId),
          isNull(todayTasks.deletedAt),
          isNull(todayTasks.completedAt),
          isNull(todayTasks.dueAt),
          isNull(todayTasks.scheduledStart),
          overdue ? lte(todayTasks.dueDate, today) : eq(todayTasks.dueDate, today),
        ),
      );
    if (!due.length) return;
    if (d.mode === 'ping') {
      for (const t of due)
        await this.notify.send({
          userId: ownerId,
          module: 'today',
          kind: 'reminder',
          type: 'today.task_reminder',
          own: true,
          title: t.title,
          body: t.dueDate! < today ? 'Overdue' : 'Today',
          url: '/today',
          actions: ACTIONS,
          dedupeKey: `today:task:${t.id}`,
          ref: `today.task:${t.id}`,
          ...deliveryFor(defaultsVia),
          priority: deliveryFor(defaultsVia).priority ?? (t.priority >= 3 ? 'high' : 'normal'),
        });
      return;
    }
    // the Brief, when it is on, already carries this (spec 0009 AC3)
    const replaced = (await this.events.emitAsync('today.digest.replaced', { ownerId })) as unknown[];
    if (replaced.some(Boolean)) return;
    const late = due.filter((t) => t.dueDate! < today).length;
    const names = due.sort((a, b) => b.priority - a.priority).map((t) => t.title);
    await this.notify.send({
      userId: ownerId,
      module: 'today',
      kind: 'digest',
      type: 'today.digest',
      title: `Today: ${due.length} ${due.length === 1 ? 'thing' : 'things'}${late ? ` (${late} overdue)` : ''}`,
      body: names.slice(0, 5).join(' · ') + (names.length > 5 ? ` · +${names.length - 5} more` : ''),
      url: '/today',
      dedupeKey: `today:digest:${today}`,
      ...deliveryFor(defaultsVia, false), // a summary never nags
    });
  }

  // ------------------------------------------------------------------ actions from any device

  @OnEvent('notify.action', { async: true, promisify: true })
  async onAction(e: NotifyAction): Promise<void> {
    if (!e.notification.ref?.startsWith('today.task:')) return;
    const taskId = e.notification.ref.slice('today.task:'.length);
    const t = await this.task(e.ownerId, taskId);
    if (!t) return;
    const p = await this.access.principal(e.ownerId);
    if (!p) return;
    const auth: AuthContext = {
      userId: e.ownerId,
      deviceId: e.deviceId,
      role: p.role,
      entitlements: p.entitlements,
    };
    const tz = (await this.settings(e.ownerId))?.timeZone ?? t.timeZone;
    const set = (fields: Record<string, unknown>) =>
      this.sync.pushAsServer(auth, [{ entity: TODAY_TASK, entityId: taskId, op: 'upsert', fields }]);

    switch (e.actionId) {
      case 'done':
        await set({ completedAt: new Date(this.now()).toISOString() });
        return;
      case 'snooze_10m': {
        // the task itself doesn't move; the reminder comes back in 10 minutes
        const moment = t.dueAt ?? t.scheduledStart;
        const jobId = `rem-${taskId}-${this.now() + 10 * 60_000}-snooze`;
        await this.queue.add(
          'remind',
          { kind: 'remind', ownerId: e.ownerId, taskId, momentMs: moment?.getTime() ?? 0, snoozed: true },
          { jobId, delay: 10 * 60_000 },
        );
        await this.redis.sadd(`today:rem:${taskId}`, jobId);
        return;
      }
      case 'later_today': {
        // three hours from now, on the next 5-minute mark
        const at = Math.ceil((this.now() + 3 * 3_600_000) / 300_000) * 300_000;
        await set({ dueAt: new Date(at).toISOString(), dueDate: null });
        return;
      }
      case 'tomorrow': {
        if (t.dueAt) {
          await set({ dueAt: new Date(t.dueAt.getTime() + 86_400_000).toISOString() });
        } else {
          const w = wallIn(new Date(this.now() + 86_400_000), tz);
          await set({
            dueDate: `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`,
            dueAt: null,
          });
        }
        return;
      }
      default:
        return;
    }
  }
}
