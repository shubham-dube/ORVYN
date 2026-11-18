import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { type NotificationView, type NotifySettings, type RegisterPushRequest } from '@orvyn/contracts';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm';
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
import { WhatsAppService } from './whatsapp.service';

export interface SendInput {
  userId: string;
  module: string;
  kind: string;
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
  notification: { id: string; module: string; kind: string; ref: string | null };
}

type Job =
  | { kind: 'deliver'; id: string; again?: boolean }
  | { kind: 'clear'; id: string; ownerId: string; type: 'dismiss' | 'read' };
const QUEUE = 'notify';
const MAX_FAILURES = 5;

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
  async send(input: SendInput): Promise<NotificationView> {
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
              dismissedAt: null,
              updatedAt: new Date(),
            },
          })
          .returning()
      : await this.db
          .insert(notifications)
          .values({ id: newId(), ...values })
          .returning();
    const view = toView(row!);
    await this.realtime.toUser(
      input.userId,
      { type: 'notify.new', notification: view },
      input.sourceDeviceId,
    );
    await this.queue.add(
      'deliver',
      { kind: 'deliver', id: view.id },
      { jobId: `deliver-${view.id}-${row!.updatedAt.getTime()}` },
    );
    return view;
  }

  private async process(job: Job): Promise<void> {
    if (job.kind === 'clear') return this.pushClear(job.ownerId, job.id, job.type);
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, job.id));
    if (!n || n.dismissedAt || n.readAt) return;
    const settings = await this.settings(n.ownerId);
    if (settings.mutedModules.includes(n.module) && n.priority !== 'urgent') return;
    if (n.priority !== 'urgent') {
      const wait = msUntilQuietEnds(new Date(), settings.quietHours);
      if (wait > 0) {
        await this.queue.add('deliver', job, { delay: wait, jobId: `deliver-${n.id}-quiet-${Date.now()}` });
        return;
      }
    }
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
    };
    const via = n.via ?? {};
    if (via.push !== false) await this.pushToTargets(n.ownerId, payload, n.sourceDeviceId);
    // copies go out once, not on every repeat
    if (!job.again) {
      if (via.email || (!n.via && settings.emailFor.includes(n.priority)))
        await this.emailCopy(n.ownerId, n.title, n.body, n.url);
      if (via.whatsapp) await this.whatsapp.notify(n.ownerId, `${n.title}${n.body ? ` — ${n.body}` : ''}`);
    }
    // a hard notification comes back until someone acts on it
    if (n.repeatEveryMin && n.repeatLeft > 0) {
      await this.db
        .update(notifications)
        .set({ repeatLeft: n.repeatLeft - 1 })
        .where(eq(notifications.id, n.id));
      await this.queue.add(
        'deliver',
        { kind: 'deliver', id: n.id, again: true },
        { delay: n.repeatEveryMin * 60_000, jobId: `deliver-${n.id}-again-${n.repeatLeft}` },
      );
    }
  }

  private async pushToTargets(
    ownerId: string,
    payload: PushPayload,
    exceptDeviceId: string | null,
    channel?: 'fcm' | 'webpush',
    onlyDeviceId?: string,
  ): Promise<{ targetId: string; deviceId: string; channel: string; outcome: string; detail: string }[]> {
    const rows = await this.db
      .select({ t: pushTargets })
      .from(pushTargets)
      .innerJoin(devices, eq(devices.id, pushTargets.deviceId))
      .where(
        and(eq(pushTargets.ownerId, ownerId), isNull(pushTargets.disabledAt), isNull(devices.revokedAt)),
      );
    const report: { targetId: string; deviceId: string; channel: string; outcome: string; detail: string }[] =
      [];
    for (const { t } of rows) {
      if (exceptDeviceId && t.deviceId === exceptDeviceId) continue;
      if (onlyDeviceId && t.deviceId !== onlyDeviceId) continue;
      if (channel && t.channel !== channel) continue;
      let r: { outcome: string; detail: string };
      try {
        r = outcomeOf(
          await this.sender.send({ channel: t.channel, address: t.address, keys: t.keys }, payload),
        );
      } catch (e) {
        r = { outcome: 'failed', detail: (e as Error).message.slice(0, 200) };
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
            failures: sql`${pushTargets.failures} + 1`,
            disabledAt: t.failures + 1 >= MAX_FAILURES ? new Date() : null,
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
    return { id: n.id, live, push };
  }

  /** Android renders pushes itself, so it can also remove them; browsers get this via the socket when open. */
  private async pushClear(ownerId: string, id: string, type: 'dismiss' | 'read'): Promise<void> {
    await this.pushToTargets(ownerId, { type, id }, null, 'fcm');
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
    const typed = text?.trim().slice(0, 200);
    if (action.reply && !typed) throw badRequest('reply_required', 'Type an answer first.');
    await this.events.emitAsync('notify.action', {
      ownerId,
      deviceId,
      actionId,
      ...(action.reply ? { text: typed } : {}),
      notification: { id: n.id, module: n.module, kind: n.kind, ref: n.ref },
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
    };
  }

  async saveSettings(ownerId: string, s: NotifySettings): Promise<NotifySettings> {
    await this.db
      .insert(notifySettings)
      .values({ ownerId, quietHours: s.quietHours, emailFor: s.emailFor, mutedModules: s.mutedModules })
      .onConflictDoUpdate({
        target: notifySettings.ownerId,
        set: { quietHours: s.quietHours, emailFor: s.emailFor, mutedModules: s.mutedModules },
      });
    return this.settings(ownerId);
  }

  async registerTarget(ownerId: string, deviceId: string, req: RegisterPushRequest): Promise<{ id: string }> {
    const address = req.channel === 'fcm' ? req.token : req.subscription.endpoint;
    const keys = req.channel === 'webpush' ? req.subscription.keys : null;
    const [row] = await this.db
      .insert(pushTargets)
      .values({ id: newId(), ownerId, deviceId, channel: req.channel, address, keys })
      .onConflictDoUpdate({
        target: pushTargets.address,
        set: { ownerId, deviceId, channel: req.channel, keys, failures: 0, disabledAt: null },
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
      title: 'New sign-in',
      body: `${p.deviceName} (${p.platform}) just signed in. Not you? Sign it out in Devices.`,
      url: '/settings/devices',
      priority: 'high',
      sourceDeviceId: p.deviceId,
      actions: [{ id: 'review', label: 'Review', open: '/settings/devices' }],
    });
  }
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
    readAt: n.readAt?.toISOString() ?? null,
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
