import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  NOTIFY_TYPE,
  type MissedNotifications,
  type NotificationView,
  type NotifySettings,
  type NotifyWay,
  type RegisterPushRequest,
} from '@orvyn/contracts';
import { Queue, Worker } from 'bullmq';
import { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { newId } from '../../db/ids';
import { devices, users } from '../auth/auth.schema';
import { layout, MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { notifications, notifySettings, pushTargets, type StoredAction } from './notify.schema';
import { outcomeOf, PUSH_SENDER, type PushPayload, type PushSender } from './push-sender';
import { msUntilQuietEnds } from './quiet-hours';
import { deliveryFor } from './ways';
import { WhatsAppService } from './whatsapp.service';

export interface SendInput {
  userId: string;
  module: string;
  kind: string;
  /** what it is, from the catalog (spec 0019): the person's rule for it decides the ways */
  type?: string;
  /** the ways were chosen on the item itself (a task's reminder, a document's expiry): they win over the rule */
  own?: boolean;
  title: string;
  body?: string;
  url?: string | null;
  actions?: StoredAction[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Same key = update the existing notification instead of adding a new one. */
  dedupeKey?: string;
  /** Not pushed to this device (it caused the notification). */
  sourceDeviceId?: string;
  /** What it is about, for actions (e.g. "today.task:<id>") */
  ref?: string;
  /** Rings like an alarm where the device can (D22). */
  alarm?: boolean;
  /**
   * Beyond the in-app inbox: normal push to devices (default true), plus email / WhatsApp copies. A reminder that
   * chose only email shows in the inbox but isn't pushed.
   */
  via?: { push?: boolean; email?: boolean; whatsapp?: boolean };
  /** Hard notifications: come back until acknowledged (read, dismissed or an action pressed). */
  repeat?: { everyMin: number; times: number };
}

/** Emitted when a person presses an action button anywhere; the owning module acts on it. */
export interface NotifyAction {
  ownerId: string;
  deviceId: string;
  actionId: string;
  /** what the person typed, for an action that asks for a reply */
  text?: string;
  notification: {
    id: string;
    module: string;
    kind: string;
    ref: string | null;
    alarm: boolean;
    priority: string;
  };
}

type Job =
  /** `at`: which time it spoke; one that has spoken again since has its own job. `held`: waited for quiet hours */
  | { kind: 'deliver'; id: string; at?: number; again?: boolean; held?: boolean }
  | { kind: 'push'; id: string; at: number; tries: number; targets: string[] }
  | { kind: 'copy'; id: string; way: 'email' | 'whatsapp' }
  | { kind: 'clear'; id: string; ownerId: string; type: 'dismiss' | 'read' };
const QUEUE = 'notify';
const MAX_FAILURES = 5;
const PUSH_RETRY_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

/** One notification pipeline for every module (spec 0001 §notify). */
@Injectable()
export class NotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('notify');
  private queue!: Queue<Job>;
  private worker?: Worker<Job>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
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
  }

  // ------------------------------------------------------------------ sending
  /**
   * The person's rule for this type (spec 0019, D-0019-2): off → nothing reaches them (kept dismissed, so dedupe and
   * actions still behave); otherwise the rule's ways — or the type's default — decide push, urgent, alarm and copies.
   * Ways set on the item itself (`own`) win.
   */
  private async applyRule(input: SendInput): Promise<{ input: SendInput; off: boolean }> {
    const info = input.type ? NOTIFY_TYPE.get(input.type) : undefined;
    if (!info || input.own || info.managedIn) return { input, off: false };
    const rule = (await this.settings(input.userId)).rules[info.key];
    if (rule && !rule.on && !info.locked) return { input, off: true };
    const ways: NotifyWay[] = rule ? rule.ways : info.ways;
    const d = deliveryFor(ways.length ? ways : undefined);
    const rank = { low: 0, normal: 1, high: 2, urgent: 3 } as const;
    const priority =
      d.priority && rank[d.priority] > rank[input.priority ?? 'normal']
        ? d.priority
        : (input.priority ?? 'normal');
    return {
      input: {
        ...input,
        priority,
        alarm: input.alarm || d.alarm,
        repeat: input.repeat ?? d.repeat,
        // in-app only: nothing pushed; copies as chosen
        via: { push: ways.length ? d.via!.push : false, email: d.via!.email, whatsapp: d.via!.whatsapp },
      },
      off: false,
    };
  }

  async send(original: SendInput): Promise<NotificationView> {
    const { input, off } = await this.applyRule(original);
    const values = {
      ownerId: input.userId,
      module: input.module,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body ?? '').slice(0, 1000),
      url: input.url ?? null,
      actions: input.actions ?? [],
      priority: input.priority ?? 'normal',
      dedupeKey: input.dedupeKey ?? null,
      sourceDeviceId: input.sourceDeviceId ?? null,
      ref: input.ref ?? null,
      alarm: input.alarm ?? false,
      via: input.via ?? null,
      repeatEveryMin: input.repeat?.everyMin ?? null,
      repeatLeft: input.repeat?.times ?? 0,
      ...(off ? { dismissedAt: new Date() } : {}),
    };
    const [row] = input.dedupeKey
      ? await this.db
          .insert(notifications)
          .values({ id: newId(), ...values })
          .onConflictDoUpdate({
            target: [notifications.ownerId, notifications.dedupeKey],
            targetWhere: sql`${notifications.dedupeKey} is not null`,
            set: {
              kind: values.kind,
              title: values.title,
              body: values.body,
              url: values.url,
              actions: values.actions,
              priority: values.priority,
              ref: values.ref,
              alarm: values.alarm,
              via: values.via,
              repeatEveryMin: values.repeatEveryMin,
              repeatLeft: values.repeatLeft,
              readAt: null,
              dismissedAt: off ? new Date() : null,
              updatedAt: new Date(),
            },
          })
          .returning()
      : await this.db
          .insert(notifications)
          .values({ id: newId(), ...values })
          .returning();
    const settings = await this.settings(input.userId);
    const view: NotificationView = {
      ...toView(row!),
      silent: off || isSilent(row!, settings, msUntilQuietEnds(new Date(), settings.quietHours) > 0),
    };
    if (off) return view;
    await this.realtime.toUser(
      input.userId,
      { type: 'notify.new', notification: view },
      input.sourceDeviceId,
    );
    await this.queue.add(
      'deliver',
      { kind: 'deliver', id: view.id, at: row!.updatedAt.getTime() },
      { jobId: `deliver-${view.id}-${row!.updatedAt.getTime()}` },
    );
    return view;
  }

  private async process(job: Job): Promise<void> {
    if (job.kind === 'clear') return this.pushClear(job.ownerId, job.id, job.type);
    if (job.kind === 'copy') return this.sendCopy(job.id, job.way);
    let [n] = await this.db.select().from(notifications).where(eq(notifications.id, job.id));
    if (!n || n.dismissedAt || n.readAt) return;
    if (job.at !== undefined && n.updatedAt.getTime() !== job.at) return;
    if (job.kind === 'push') return this.pushAndRetry(n, job.at, job.tries, job.targets);
    const settings = await this.settings(n.ownerId);
    if (settings.mutedModules.includes(n.module) && n.priority !== 'urgent') return;
    if (n.priority !== 'urgent') {
      const wait = msUntilQuietEnds(new Date(), settings.quietHours);
      if (wait > 0) {
        await this.queue.add(
          'deliver',
          { ...job, held: true },
          { delay: wait, jobId: `deliver-${n.id}-quiet-${Date.now()}` },
        );
        return;
      }
    }
    const push = (n.via ?? {}).push !== false;
    if (job.again) {
      // it speaks again: a new moment, so open devices (PC, Chrome) that showed it show it again
      [n] = await this.db
        .update(notifications)
        .set({ repeatLeft: sql`greatest(${notifications.repeatLeft} - 1, 0)` })
        .where(eq(notifications.id, n.id))
        .returning();
      if (!n) return;
    }
    const at = n.updatedAt.getTime();
    if (push && (job.again || job.held))
      await this.realtime.toUser(
        n.ownerId,
        { type: 'notify.new', notification: toView(n) },
        n.sourceDeviceId ?? undefined,
      );
    if (push) await this.pushAndRetry(n, at);
    // copies go out once, not on every repeat, each retried on its own (a failed mail doesn't ring the phone again)
    if (!job.again) {
      if (n.via?.email || (!n.via && settings.emailFor.includes(n.priority)))
        await this.copy(n.id, at, 'email');
      if (n.via?.whatsapp) await this.copy(n.id, at, 'whatsapp');
    }
    // a hard notification comes back until someone acts on it
    if (n.repeatEveryMin && n.repeatLeft > 0)
      await this.queue.add(
        'deliver',
        { kind: 'deliver', id: n.id, at, again: true },
        { delay: n.repeatEveryMin * 60_000, jobId: `deliver-${n.id}-again-${at}` },
      );
  }

  private async copy(id: string, at: number, way: 'email' | 'whatsapp') {
    await this.queue.add('copy', { kind: 'copy', id, way }, { jobId: `copy-${id}-${way}-${at}` });
  }

  private async sendCopy(id: string, way: 'email' | 'whatsapp'): Promise<void> {
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, id));
    if (!n || n.dismissedAt) return;
    if (way === 'email') await this.emailCopy(n.ownerId, n.title, n.body, n.url);
    else await this.whatsapp.notify(n.ownerId, `${n.title}${n.body ? ` — ${n.body}` : ''}`);
  }

  /** A push service that is down for a moment is tried again, only where it failed. */
  private async pushAndRetry(
    n: typeof notifications.$inferSelect,
    at: number,
    tries = 0,
    only?: string[],
  ): Promise<void> {
    const payload: PushPayload = {
      type: 'notify',
      id: n.id,
      title: n.title,
      body: n.body,
      url: n.url,
      module: n.module,
      priority: n.priority,
      alarm: n.alarm,
      actions: n.actions,
      ...taskOf(n.ref),
    };
    const report = await this.pushToTargets(n.ownerId, payload, n.sourceDeviceId, undefined, undefined, only);
    const failed = report.filter((r) => r.again).map((r) => r.targetId);
    const delay = PUSH_RETRY_MS[tries];
    if (failed.length && delay)
      await this.queue.add(
        'push',
        { kind: 'push', id: n.id, at, tries: tries + 1, targets: failed },
        { delay, jobId: `push-${n.id}-${at}-${tries + 1}` },
      );
  }

  private async pushToTargets(
    ownerId: string,
    payload: PushPayload,
    exceptDeviceId: string | null,
    channel?: 'fcm' | 'webpush',
    onlyDeviceId?: string,
    onlyTargets?: string[],
  ): Promise<PushReport[]> {
    const rows = await this.db
      .select({ t: pushTargets })
      .from(pushTargets)
      .innerJoin(devices, eq(devices.id, pushTargets.deviceId))
      .where(
        and(eq(pushTargets.ownerId, ownerId), isNull(pushTargets.disabledAt), isNull(devices.revokedAt)),
      );
    const report: PushReport[] = [];
    for (const { t } of rows) {
      if (exceptDeviceId && t.deviceId === exceptDeviceId) continue;
      if (onlyDeviceId && t.deviceId !== onlyDeviceId) continue;
      if (channel && t.channel !== channel) continue;
      if (onlyTargets && !onlyTargets.includes(t.id)) continue;
      let r: { outcome: string; detail: string; again?: boolean };
      try {
        r = outcomeOf(
          await this.sender.send(
            { channel: t.channel, format: t.format, address: t.address, keys: t.keys },
            payload,
          ),
        );
      } catch (e) {
        r = { outcome: 'failed', detail: (e as Error).message.slice(0, 200), again: true };
      }
      report.push({ targetId: t.id, deviceId: t.deviceId, channel: t.channel, ...r });
      const last = { lastResult: r.outcome, lastError: r.detail || null, lastAt: new Date() };
      if (r.outcome === 'gone')
        await this.db
          .update(pushTargets)
          .set({ ...last, disabledAt: new Date() })
          .where(eq(pushTargets.id, t.id));
      else if (r.outcome === 'failed')
        await this.db
          .update(pushTargets)
          .set({
            ...last,
            // the service being down says nothing about this device
            ...(r.again
              ? {}
              : {
                  failures: sql`${pushTargets.failures} + 1`,
                  disabledAt: t.failures + 1 >= MAX_FAILURES ? new Date() : null,
                }),
          })
          .where(eq(pushTargets.id, t.id));
      else
        await this.db
          .update(pushTargets)
          .set({ ...last, failures: 0 })
          .where(eq(pushTargets.id, t.id));
    }
    return report;
  }

  /**
   * How notifications reach each of the person's devices (spec 0007 A3): open now (the live socket — the web app,
   * the Windows tray, the extension), push targets (browser web push, Android FCM) with their last result, and what
   * the server itself can do.
   */
  async delivery(ownerId: string) {
    const devs = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        platform: devices.platform,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), isNull(devices.revokedAt)));
    const targets = await this.db.select().from(pushTargets).where(eq(pushTargets.ownerId, ownerId));
    const live = new Set(this.realtime.connectedDevices(ownerId));
    return {
      server: this.sender.capabilities?.() ?? { webpush: true, fcm: true },
      devices: devs.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        live: live.has(d.id),
        push: targets
          .filter((t) => t.deviceId === d.id)
          .map((t) => ({
            id: t.id,
            channel: t.channel,
            active: !t.disabledAt,
            lastResult: t.lastResult,
            lastError: t.lastError,
            lastAt: t.lastAt?.toISOString() ?? null,
          })),
      })),
    };
  }

  /**
   * A test that says what happened: the notification goes to the inbox (and to every open device over the socket),
   * and push is tried right now — to one device, or all — with each service's answer returned.
   */
  async test(ownerId: string, deviceId?: string) {
    const n = await this.send({
      userId: ownerId,
      module: 'core',
      kind: 'test',
      title: 'Hello from ORVYN',
      body: 'Notifications are working on this device.',
      priority: 'normal',
      via: { push: false }, // pushed below, so the result can be reported
      actions: [{ id: 'ok', label: 'Nice' }],
    });
    const push = await this.pushToTargets(
      ownerId,
      {
        type: 'notify',
        id: n.id,
        title: n.title,
        body: n.body,
        url: null,
        module: 'core',
        priority: 'normal',
        actions: [],
      },
      null,
      undefined,
      deviceId,
    );
    const live = this.realtime.connectedDevices(ownerId).filter((d) => !deviceId || d === deviceId);
    return { id: n.id, live, push: push.map(({ again: _, ...p }) => p) };
  }

  /** Android renders pushes itself, so it can also remove them; browsers get this via the socket when open. */
  private async pushClear(ownerId: string, id: string, type: 'dismiss' | 'read'): Promise<void> {
    const [n] = await this.db
      .select({ ref: notifications.ref })
      .from(notifications)
      .where(eq(notifications.id, id));
    await this.pushToTargets(ownerId, { type, id, ...taskOf(n?.ref ?? null) }, null, 'fcm');
  }

  private async emailCopy(ownerId: string, title: string, body: string, url: string | null): Promise<void> {
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, ownerId));
    if (!u) return;
    const link = url ? `${this.env.WEB_URL}${url.startsWith('/') ? url : '/' + url}` : this.env.WEB_URL;
    await this.mail.send({
      to: u.email,
      subject: title,
      text: `${body}\n\n${link}`,
      html: layout(
        escapeHtml(title),
        `<p style="font-size:15px;color:#475569">${escapeHtml(body)}</p><p><a href="${link}" style="color:#1a56c4">Open ORVYN</a></p>`,
      ),
    });
  }

  // ------------------------------------------------------------------ reading / clearing
  async list(
    ownerId: string,
    before?: string,
    limit = 50,
  ): Promise<{ items: NotificationView[]; unread: number }> {
    const conds = [eq(notifications.ownerId, ownerId), isNull(notifications.dismissedAt)];
    if (before) conds.push(lt(notifications.createdAt, new Date(before)));
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(limit, 100));
    const [{ unread } = { unread: 0 }] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.ownerId, ownerId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      );
    return { items: rows.map(toView), unread };
  }

  async markRead(ownerId: string, id: string, deviceId: string): Promise<void> {
    const r = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.ownerId, ownerId)))
      .returning({ id: notifications.id });
    if (!r.length) throw notFound();
    await this.realtime.toUser(ownerId, { type: 'notify.read', id }, deviceId);
    await this.queue.add('clear', { kind: 'clear', id, ownerId, type: 'read' });
  }

  /**
   * An action button pressed on any device (shade, toast, web push, extension, in-app). The owning module does the
   * work (awaited, so the reply means it's done), then the notification clears everywhere.
   */
  async act(ownerId: string, id: string, actionId: string, deviceId: string, text?: string): Promise<void> {
    const [n] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.ownerId, ownerId)));
    if (!n) throw notFound();
    const action = n.actions.find((a) => a.id === actionId);
    if (!action) throw badRequest('unknown_action', 'That action is not available.');
    const typed = text?.trim().slice(0, 500);
    if (action.reply && !typed) throw badRequest('reply_required', 'Type an answer first.');
    await this.events.emitAsync('notify.action', {
      ownerId,
      deviceId,
      actionId,
      ...(action.reply ? { text: typed } : {}),
      notification: {
        id: n.id,
        module: n.module,
        kind: n.kind,
        ref: n.ref,
        alarm: n.alarm,
        priority: n.priority,
      },
    } satisfies NotifyAction);
    // the module may have asked again under the same key (e.g. "didn't catch that"): keep that one
    const [now] = await this.db
      .select({ dismissedAt: notifications.dismissedAt, updatedAt: notifications.updatedAt })
      .from(notifications)
      .where(eq(notifications.id, id));
    const replaced = now && now.updatedAt.getTime() > n.updatedAt.getTime();
    if (now && !now.dismissedAt && !replaced) await this.dismiss(ownerId, id, deviceId, true);
  }

  async dismiss(ownerId: string, id: string, deviceId: string, everywhere = false): Promise<void> {
    const r = await this.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.ownerId, ownerId)))
      .returning({ id: notifications.id });
    if (!r.length) throw notFound();
    await this.realtime.toUser(ownerId, { type: 'notify.dismissed', id }, everywhere ? undefined : deviceId);
    await this.queue.add('clear', { kind: 'clear', id, ownerId, type: 'dismiss' });
  }

  /**
   * What this device should still pop up: unread, changed since it last looked, not raised by itself. In quiet hours
   * only the urgent ones, and `until` stays put so the rest come when quiet hours end. The window overlaps the last one
   * (the database and this server may disagree about the time), so a device skips an id + updatedAt it has shown.
   */
  async missed(ownerId: string, deviceId: string, since?: Date): Promise<MissedNotifications> {
    const now = new Date();
    if (!since) return { items: [], cleared: [], until: now.toISOString() };
    const settings = await this.settings(ownerId);
    const quiet = msUntilQuietEnds(now, settings.quietHours) > 0;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.ownerId, ownerId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
          gt(notifications.updatedAt, new Date(since.getTime() - MISSED_OVERLAP_MS)),
          or(isNull(notifications.sourceDeviceId), ne(notifications.sourceDeviceId, deviceId)),
        ),
      )
      .orderBy(asc(notifications.updatedAt))
      .limit(200);
    const from = new Date(since.getTime() - MISSED_OVERLAP_MS);
    const cleared = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.ownerId, ownerId),
          or(gt(notifications.readAt, from), gt(notifications.dismissedAt, from)),
        ),
      )
      .limit(500);
    return {
      cleared: cleared.map((c) => c.id),
      items: rows.filter((r) => !isSilent(r, settings, quiet)).map((r) => toView(r)),
      until: quiet
        ? since.toISOString()
        : rows.length === 200
          ? rows.at(-1)!.updatedAt.toISOString()
          : now.toISOString(),
    };
  }

  /** Has this person ever been sent a notification with this key (read or not)? */
  async hasKey(ownerId: string, dedupeKey: string): Promise<boolean> {
    const [r] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.ownerId, ownerId), eq(notifications.dedupeKey, dedupeKey)))
      .limit(1);
    return !!r;
  }

  /** A module saying "that's handled" (e.g. the task was done on another device): clears it everywhere, quietly. */
  async dismissByKey(ownerId: string, dedupeKey: string): Promise<void> {
    const rows = await this.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(notifications.ownerId, ownerId),
          eq(notifications.dedupeKey, dedupeKey),
          isNull(notifications.dismissedAt),
        ),
      )
      .returning({ id: notifications.id });
    for (const r of rows) {
      await this.realtime.toUser(ownerId, { type: 'notify.dismissed', id: r.id });
      await this.queue.add('clear', { kind: 'clear', id: r.id, ownerId, type: 'dismiss' });
    }
  }

  async dismissAll(ownerId: string, deviceId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ dismissedAt: new Date() })
      .where(and(eq(notifications.ownerId, ownerId), isNull(notifications.dismissedAt)))
      .returning({ id: notifications.id });
    for (const r of rows) {
      await this.realtime.toUser(ownerId, { type: 'notify.dismissed', id: r.id }, deviceId);
      await this.queue.add('clear', { kind: 'clear', id: r.id, ownerId, type: 'dismiss' });
    }
    return rows.length;
  }

  // ------------------------------------------------------------------ settings & targets
  async settings(ownerId: string): Promise<NotifySettings> {
    const [s] = await this.db.select().from(notifySettings).where(eq(notifySettings.ownerId, ownerId));
    return {
      quietHours: s?.quietHours ?? null,
      emailFor: (s?.emailFor ?? ['urgent']) as NotifySettings['emailFor'],
      mutedModules: s?.mutedModules ?? [],
      rules: (s?.rules ?? {}) as NotifySettings['rules'],
    };
  }

  /** "Send me a sample" (D-0019-7): a marked sample of one type, through its ways — once a minute at most. */
  async sample(ownerId: string, type: string) {
    const info = NOTIFY_TYPE.get(type);
    if (!info) throw notFound();
    const [last] = await this.db
      .select({ at: notifications.updatedAt })
      .from(notifications)
      .where(and(eq(notifications.ownerId, ownerId), eq(notifications.dedupeKey, `sample:${type}`)));
    if (last && Date.now() - last.at.getTime() < 60_000)
      throw badRequest('too_soon', 'One sample a minute — check the one just sent.');
    return this.send({
      userId: ownerId,
      module: info.module,
      kind: 'sample',
      type,
      title: `Sample · ${info.label}`,
      body: `This is how “${info.label}” reaches you. ${info.when}.`,
      url: '/settings#notifications',
      dedupeKey: `sample:${type}`,
      actions: [{ id: 'ok', label: 'Got it' }],
    });
  }

  async saveSettings(ownerId: string, s: NotifySettings): Promise<NotifySettings> {
    await this.db
      .insert(notifySettings)
      .values({
        ownerId,
        quietHours: s.quietHours,
        emailFor: s.emailFor,
        mutedModules: s.mutedModules,
        rules: cleanRules(s.rules),
      })
      .onConflictDoUpdate({
        target: notifySettings.ownerId,
        set: {
          quietHours: s.quietHours,
          emailFor: s.emailFor,
          mutedModules: s.mutedModules,
          rules: cleanRules(s.rules),
        },
      });
    return this.settings(ownerId);
  }

  async registerTarget(ownerId: string, deviceId: string, req: RegisterPushRequest): Promise<{ id: string }> {
    const address = req.channel === 'fcm' ? (req.fid ?? req.token!) : req.subscription.endpoint;
    const keys = req.channel === 'webpush' ? req.subscription.keys : null;
    const format = req.channel === 'fcm' && req.fid ? ('fid' as const) : ('token' as const);
    const [row] = await this.db
      .insert(pushTargets)
      .values({ id: newId(), ownerId, deviceId, channel: req.channel, format, address, keys })
      .onConflictDoUpdate({
        target: pushTargets.address,
        set: { ownerId, deviceId, channel: req.channel, format, keys, failures: 0, disabledAt: null },
      })
      .returning({ id: pushTargets.id });
    // one active target per device and channel
    await this.db
      .update(pushTargets)
      .set({ disabledAt: new Date() })
      .where(
        and(
          eq(pushTargets.deviceId, deviceId),
          eq(pushTargets.channel, req.channel),
          ne(pushTargets.id, row!.id),
          isNull(pushTargets.disabledAt),
        ),
      );
    return { id: row!.id };
  }

  async removeTarget(ownerId: string, id: string): Promise<void> {
    await this.db
      .update(pushTargets)
      .set({ disabledAt: new Date() })
      .where(and(eq(pushTargets.id, id), eq(pushTargets.ownerId, ownerId)));
  }

  // ------------------------------------------------------------------ security notifications
  @OnEvent('auth.signed_in', { async: true, promisify: true })
  async onSignedIn(p: {
    userId: string;
    deviceId: string;
    deviceName: string;
    platform: string;
  }): Promise<void> {
    const [{ others } = { others: 0 }] = await this.db
      .select({ others: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(eq(devices.ownerId, p.userId), isNull(devices.revokedAt), ne(devices.id, p.deviceId)));
    if (!others) return; // first device: nothing to warn about
    await this.send({
      userId: p.userId,
      module: 'core',
      kind: 'security.new_device',
      type: 'security.new_device',
      title: 'New sign-in',
      body: `${p.deviceName} (${p.platform}) just signed in. Not you? Sign it out in Devices.`,
      url: '/settings#security',
      priority: 'high',
      sourceDeviceId: p.deviceId,
      actions: [{ id: 'review', label: 'Review', open: '/settings#security' }],
    });
  }
}

/** Only known types; security stays on; an alarm only where it makes sense; a rule that is the default goes. */
function cleanRules(rules: NotifySettings['rules'] | undefined): NotifySettings['rules'] {
  const out: NotifySettings['rules'] = {};
  for (const [k, r] of Object.entries(rules ?? {})) {
    const info = NOTIFY_TYPE.get(k);
    if (!info || info.managedIn) continue;
    const ways = [...new Set(r.ways)].filter((w) => w !== 'alarm' || info.alarm);
    const on = info.locked ? true : r.on;
    const same = on && ways.length === info.ways.length && ways.every((w) => info.ways.includes(w));
    if (!same) out[k] = { on, ways };
  }
  return out;
}

interface PushReport {
  targetId: string;
  deviceId: string;
  channel: string;
  outcome: string;
  detail: string;
  /** worth trying again */
  again?: boolean;
}

/** The task a reminder is about, so a phone that rings by itself for it doesn't ring twice. */
const taskOf = (ref: string | null) =>
  ref?.startsWith('today.task:') ? { task: ref.slice('today.task:'.length) } : {};

const MISSED_OVERLAP_MS = 2 * 60_000;

/** In the inbox only, the same rule push follows. */
function isSilent(n: typeof notifications.$inferSelect, s: NotifySettings, quiet: boolean): boolean {
  if (n.kind === 'test') return false; // asked for just now, to be seen
  if (n.via?.push === false) return true;
  return n.priority !== 'urgent' && (quiet || s.mutedModules.includes(n.module));
}

function toView(n: typeof notifications.$inferSelect): NotificationView {
  return {
    id: n.id,
    module: n.module,
    kind: n.kind,
    title: n.title,
    body: n.body,
    url: n.url,
    actions: n.actions,
    priority: n.priority,
    alarm: n.alarm,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    silent: false,
    readAt: n.readAt?.toISOString() ?? null,
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
