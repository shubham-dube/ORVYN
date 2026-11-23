import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type EventFields,
  type Mutation,
  PROJECT_COLOURS,
  TODAY_CALENDAR,
  TODAY_EVENT,
} from '@orvyn/contracts';
import { Queue, Worker } from 'bullmq';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import Redis from 'ioredis';
import { v5 } from 'uuid';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { type AuthContext } from '../auth/auth.decorators';
import { NotifyService } from '../notify/notify.service';
import { SERVER_DEVICE, serverOrigin, type SyncApplied, SyncService } from '../sync/sync.service';
import { todayCalendars, todayEvents, todaySettings } from '../today/today.schema';
import { calendarAccounts, calendarSyncState } from './calendar.schema';
import {
  EtagMismatch,
  type GEvent,
  GoogleCalendarClient,
  GoogleHttpError,
  ReconnectNeeded,
  SyncTokenGone,
  GMAIL_SCOPE,
} from './google.client';
import { eventIdFor, fromGoogle, instanceId, toGoogle } from './google-map';
import { TokenBox } from './token-box';

type Job =
  | { kind: 'sync'; ownerId: string; calendarId: string }
  | { kind: 'poll'; ownerId: string; accountId: string }
  | { kind: 'push'; ownerId: string; eventId: string };

type Account = typeof calendarAccounts.$inferSelect;
type EventRow = typeof todayEvents.$inferSelect;
const QUEUE = 'calendar';
const CAL_NS = '0b8f6a3e-58c4-4e0a-9a51-7d1c2f3e4b5a';
const FULL_SYNC_DAYS = 120;

/**
 * Google Calendar two-way sync (spec 0002 M5, AC3, D15). Several accounts per person; each account's calendars
 * become `today.calendar` rows the person can show/hide; events sync incrementally (sync tokens), arrive by push
 * channel or a 5-minute poll, and edits from any device go back to Google with etags. All server writes go
 * through the sync engine, so every device converges.
 */
/** Google's holiday calendars: `en.indian#holiday@group.v.calendar.google.com` and the like. */
export const HOLIDAYS = /#holiday@group\.v\.calendar\.google\.com$/;

@Injectable()
export class CalendarService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('calendar');
  private queue!: Queue<Job>;
  private worker?: Worker<Job>;
  private redis!: Redis;
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly google: GoogleCalendarClient,
    private readonly box: TokenBox,
    private readonly sync: SyncService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    const connection = { url: this.env.REDIS_URL };
    this.redis = new Redis(this.env.REDIS_URL);
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
        removeOnFail: 1000,
      },
    });
    if (this.env.PROCESS_ROLE !== 'api') {
      this.worker = new Worker<Job>(QUEUE, (job) => this.process(job.data), { connection, concurrency: 4 });
      this.worker.on('failed', (job, err) => this.log.warn(`job ${job?.name} failed: ${err.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redis?.quit();
  }

  async process(job: Job): Promise<void> {
    if (job.kind === 'sync') return this.syncCalendar(job.ownerId, job.calendarId);
    if (job.kind === 'poll') return this.poll(job.ownerId, job.accountId);
    return this.pushEvent(job.ownerId, job.eventId);
  }

  /** Tests (no worker): run whatever is waiting, in order, until nothing is left. */
  async drain(): Promise<number> {
    let n = 0;
    for (;;) {
      // the 5-minute poll schedulers stay; everything else runs now
      const jobs = (await this.queue.getJobs(['waiting', 'prioritized', 'delayed'], 0, 50, true)).filter(
        (j) => !j.repeatJobKey,
      );
      if (!jobs.length) return n;
      for (const j of jobs) {
        await j.remove().catch(() => undefined);
        await this.process(j.data);
        n++;
      }
    }
  }

  private async auth(ownerId: string): Promise<AuthContext | null> {
    const p = await this.access.principal(ownerId);
    return p
      ? { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements }
      : null;
  }

  private async write(ownerId: string, changes: Pick<Mutation, 'entity' | 'entityId' | 'op' | 'fields'>[]) {
    const a = await this.auth(ownerId);
    if (!a || !changes.length) return;
    for (let i = 0; i < changes.length; i += 100) await this.sync.pushAsServer(a, changes.slice(i, i + 100));
  }

  // ------------------------------------------------------------------ connecting an account

  async start(ownerId: string, loginHint?: string, o: { gmail?: boolean } = {}): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await this.redis.set(`cal:state:${state}`, JSON.stringify({ ownerId, verifier }), 'EX', 600);
    return this.google.authUrl(
      state,
      createHash('sha256').update(verifier).digest('base64url'),
      loginHint,
      o.gmail ? [GMAIL_SCOPE] : [],
    );
  }

  /** The OAuth callback: returns where to send the browser. */
  async callback(code: string | undefined, state: string | undefined, error?: string): Promise<string> {
    const back = (r: string) => `${this.env.WEB_URL}/settings?calendar=${r}`;
    const saved = state ? await this.redis.getdel(`cal:state:${state}`) : null;
    if (!saved) return back('expired');
    const { ownerId, verifier } = JSON.parse(saved) as { ownerId: string; verifier: string };
    if (error || !code) return back('cancelled');
    try {
      const t = await this.google.exchange(code, verifier);
      const email = await this.google.email(t.access_token);
      const [existing] = await this.db
        .select()
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.ownerId, ownerId),
            eq(calendarAccounts.provider, 'google'),
            eq(calendarAccounts.email, email),
          ),
        );
      const refresh = t.refresh_token ?? (existing ? await this.box.open(existing.refreshTokenEnc) : null);
      if (!refresh) return back('no_offline_access');
      const values = {
        refreshTokenEnc: await this.box.seal(refresh),
        accessTokenEnc: await this.box.seal(t.access_token),
        accessExpiresAt: new Date(this.now() + t.expires_in * 1000),
        status: 'active',
        lastError: null,
        // Google adds what was granted before (include_granted_scopes), so this is everything the account allows
        scopes: (t.scope ?? '').split(' ').filter(Boolean),
      };
      let account: Account;
      if (existing) {
        [account] = (await this.db
          .update(calendarAccounts)
          .set(values)
          .where(eq(calendarAccounts.id, existing.id))
          .returning()) as [Account];
      } else {
        [account] = (await this.db
          .insert(calendarAccounts)
          .values({ id: randomUUID(), ownerId, provider: 'google', email, ...values })
          .returning()) as [Account];
      }
      await this.refreshCalendars(account);
      await this.queue.upsertJobScheduler(
        `calpoll-${account.id}`,
        { every: 5 * 60_000 },
        { name: 'poll', data: { kind: 'poll', ownerId, accountId: account.id } },
      );
      await this.queue.add('poll', { kind: 'poll', ownerId, accountId: account.id });
      return back('connected');
    } catch (e) {
      this.log.warn(`connect failed: ${(e as Error).message}`);
      return back('failed');
    }
  }

  async accounts(ownerId: string) {
    const rows = await this.db.select().from(calendarAccounts).where(eq(calendarAccounts.ownerId, ownerId));
    return rows.map((a) => ({
      id: a.id,
      provider: a.provider,
      email: a.email,
      status: a.status,
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      gmail: a.scopes.includes(GMAIL_SCOPE),
    }));
  }

  // ------------------------------------------------------------------ meetings and mail (spec 0007 C2)

  /**
   * Schedules a meeting on one of the person's Google accounts: an event on its main calendar with a Meet link and the
   * attendees. Google itself emails the invitations (and updates them if the event changes). The event then comes
   * into ORVYN's calendar with the next sync, which runs right away.
   */
  async scheduleMeeting(
    ownerId: string,
    m: {
      accountId: string;
      title: string;
      start: string;
      end: string;
      timeZone: string;
      attendees: string[];
      notes: string;
      meet: boolean;
    },
  ) {
    const a = await this.account(ownerId, m.accountId);
    if (!a) return null;
    const at = await this.accessToken(a);
    const e = await this.google.meeting(at, 'primary', {
      summary: m.title,
      description: m.notes || undefined,
      start: { dateTime: m.start, timeZone: m.timeZone },
      end: { dateTime: m.end, timeZone: m.timeZone },
      attendees: [...new Set(m.attendees.map((x) => x.trim().toLowerCase()))].map((email) => ({ email })),
      meet: m.meet,
      requestId: randomUUID(),
    });
    await this.queue.add('poll', { kind: 'poll', ownerId, accountId: a.id });
    return { eventId: e.id, meetUrl: e.hangoutLink ?? null, htmlLink: e.htmlLink ?? null, account: a.email };
  }

  /** Unread mail on an account that has Gmail added; null when it doesn't. */
  async inbox(ownerId: string, accountId: string) {
    const a = await this.account(ownerId, accountId);
    if (!a || !a.scopes.includes(GMAIL_SCOPE)) return null;
    return this.google.inbox(await this.accessToken(a));
  }

  private async account(ownerId: string, accountId: string): Promise<Account | null> {
    const [a] = await this.db
      .select()
      .from(calendarAccounts)
      .where(and(eq(calendarAccounts.id, accountId), eq(calendarAccounts.ownerId, ownerId)));
    return a ?? null;
  }

  /** A fresh access token, refreshing when needed. A refused refresh marks the account and tells the person. */
  private async accessToken(a: Account): Promise<string> {
    if (a.accessTokenEnc && a.accessExpiresAt && a.accessExpiresAt.getTime() > this.now() + 60_000) {
      return this.box.open(a.accessTokenEnc);
    }
    try {
      const t = await this.google.refresh(await this.box.open(a.refreshTokenEnc));
      await this.db
        .update(calendarAccounts)
        .set({
          accessTokenEnc: await this.box.seal(t.access_token),
          accessExpiresAt: new Date(this.now() + t.expires_in * 1000),
          ...(t.refresh_token ? { refreshTokenEnc: await this.box.seal(t.refresh_token) } : {}),
        })
        .where(eq(calendarAccounts.id, a.id));
      return t.access_token;
    } catch (e) {
      if (e instanceof ReconnectNeeded && a.status !== 'needs_reconnect') {
        await this.db
          .update(calendarAccounts)
          .set({ status: 'needs_reconnect', lastError: 'Google stopped accepting this connection.' })
          .where(eq(calendarAccounts.id, a.id));
        await this.notify.send({
          userId: a.ownerId,
          module: 'today',
          kind: 'system',
          title: 'Reconnect Google Calendar',
          body: `${a.email} needs to be connected again to keep syncing.`,
          url: '/settings',
          dedupeKey: `calendar:reconnect:${a.id}`,
        });
      }
      throw e;
    }
  }

  /** The account's calendars → `today.calendar` rows (new ones visible if Google shows them; settings kept). */
  async refreshCalendars(a: Account): Promise<void> {
    const at = await this.accessToken(a);
    const remote = await this.google.calendars(at);
    const mine = await this.db
      .select()
      .from(todayCalendars)
      .where(and(eq(todayCalendars.ownerId, a.ownerId), eq(todayCalendars.accountId, a.id)));
    const changes: Pick<Mutation, 'entity' | 'entityId' | 'op' | 'fields'>[] = [];
    remote.forEach((g, i) => {
      const id = v5(`${a.id}|${g.id}`, CAL_NS);
      const known = mine.find((c) => c.id === id && !c.deletedAt);
      changes.push({
        entity: TODAY_CALENDAR,
        entityId: id,
        op: 'upsert',
        fields: {
          name: g.summaryOverride ?? g.summary,
          provider: 'google',
          accountId: a.id,
          externalId: g.id,
          writable: g.accessRole === 'owner' || g.accessRole === 'writer',
          ...(known
            ? {}
            : {
                // Google's public-holiday calendars (one per account) start switched off (spec 0014)
                visible: !!(g.primary || g.selected) && !HOLIDAYS.test(g.id),
                colour: PROJECT_COLOURS[i % PROJECT_COLOURS.length],
              }),
        },
      });
    });
    const gone = mine.filter(
      (c) => !c.deletedAt && !remote.some((g) => v5(`${a.id}|${g.id}`, CAL_NS) === c.id),
    );
    await this.write(a.ownerId, changes);
    for (const c of gone) await this.dropCalendar(a.ownerId, c.id);
    for (const g of remote) {
      const id = v5(`${a.id}|${g.id}`, CAL_NS);
      await this.db
        .insert(calendarSyncState)
        .values({ calendarId: id, ownerId: a.ownerId, accountId: a.id, externalId: g.id })
        .onConflictDoNothing();
    }
  }

  private async dropCalendar(ownerId: string, calendarId: string): Promise<void> {
    const events = await this.db
      .select({ id: todayEvents.id })
      .from(todayEvents)
      .where(
        and(
          eq(todayEvents.ownerId, ownerId),
          eq(todayEvents.calendarId, calendarId),
          isNull(todayEvents.deletedAt),
        ),
      );
    await this.write(ownerId, [
      ...events.map((e) => ({ entity: TODAY_EVENT, entityId: e.id, op: 'delete' as const, fields: {} })),
      { entity: TODAY_CALENDAR, entityId: calendarId, op: 'delete', fields: {} },
    ]);
    await this.db.delete(calendarSyncState).where(eq(calendarSyncState.calendarId, calendarId));
  }

  async disconnect(ownerId: string, accountId: string): Promise<boolean> {
    const a = await this.account(ownerId, accountId);
    if (!a) return false;
    const states = await this.db
      .select()
      .from(calendarSyncState)
      .where(eq(calendarSyncState.accountId, a.id));
    try {
      const at = await this.accessToken(a);
      for (const s of states)
        if (s.channelId && s.channelResourceId) await this.google.stop(at, s.channelId, s.channelResourceId);
    } catch {
      /* the account may already be revoked: carry on removing it here */
    }
    await this.google.revoke(await this.box.open(a.refreshTokenEnc));
    const cals = await this.db
      .select({ id: todayCalendars.id })
      .from(todayCalendars)
      .where(and(eq(todayCalendars.ownerId, ownerId), eq(todayCalendars.accountId, a.id)));
    for (const c of cals) await this.dropCalendar(ownerId, c.id);
    await this.queue.removeJobScheduler(`calpoll-${a.id}`);
    await this.db.delete(calendarAccounts).where(eq(calendarAccounts.id, a.id));
    return true;
  }

  // ------------------------------------------------------------------ Google → ORVYN

  /** Every 5 minutes per account (and right after connecting): renew push channels, sync visible calendars. */
  async poll(ownerId: string, accountId: string): Promise<void> {
    const a = await this.account(ownerId, accountId);
    if (!a || a.status !== 'active') return;
    await this.refreshCalendars(a);
    const visible = await this.db
      .select({ id: todayCalendars.id })
      .from(todayCalendars)
      .where(
        and(
          eq(todayCalendars.ownerId, ownerId),
          eq(todayCalendars.accountId, a.id),
          eq(todayCalendars.visible, true),
          isNull(todayCalendars.deletedAt),
        ),
      );
    for (const c of visible) {
      await this.ensureChannel(a, c.id);
      await this.syncCalendar(ownerId, c.id);
    }
    await this.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: new Date(this.now()), lastError: null })
      .where(eq(calendarAccounts.id, a.id));
  }

  private channelToken(channelId: string): string {
    return createHmac('sha256', this.env.JWT_SECRET)
      .update(`calendar-channel:${channelId}`)
      .digest('base64url');
  }

  /** Push notifications need a public https address; locally the poll does the work. */
  private async ensureChannel(a: Account, calendarId: string): Promise<void> {
    if (!this.env.API_URL.startsWith('https://')) return;
    const [s] = await this.db
      .select()
      .from(calendarSyncState)
      .where(eq(calendarSyncState.calendarId, calendarId));
    if (!s || (s.channelExpiresAt && s.channelExpiresAt.getTime() > this.now() + 24 * 3_600_000)) return;
    const at = await this.accessToken(a);
    if (s.channelId && s.channelResourceId) await this.google.stop(at, s.channelId, s.channelResourceId);
    const id = randomUUID();
    try {
      const ch = await this.google.watch(at, s.externalId, {
        id,
        token: this.channelToken(id),
        address: `${this.env.API_URL}/calendar/google/webhook`,
      });
      await this.db
        .update(calendarSyncState)
        .set({
          channelId: id,
          channelResourceId: ch.resourceId,
          channelExpiresAt: new Date(ch.expiration ? Number(ch.expiration) : this.now() + 7 * 86_400_000),
        })
        .where(eq(calendarSyncState.calendarId, calendarId));
    } catch (e) {
      this.log.warn(`watch failed: ${(e as Error).message}`); // the poll still keeps things current
    }
  }

  /** Google said something changed on a channel: verify it is ours, then sync that calendar soon. */
  async webhook(channelId: string | undefined, token: string | undefined): Promise<boolean> {
    if (!channelId || !token) return false;
    const want = Buffer.from(this.channelToken(channelId));
    const got = Buffer.from(token);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    const [s] = await this.db
      .select()
      .from(calendarSyncState)
      .where(eq(calendarSyncState.channelId, channelId));
    if (!s) return false;
    await this.queue.add(
      'sync',
      { kind: 'sync', ownerId: s.ownerId, calendarId: s.calendarId },
      { jobId: `sync-${s.calendarId}-${Math.floor(this.now() / 5000)}` }, // bursts collapse
    );
    return true;
  }

  async syncCalendar(ownerId: string, calendarId: string): Promise<void> {
    const [s] = await this.db
      .select()
      .from(calendarSyncState)
      .where(and(eq(calendarSyncState.calendarId, calendarId), eq(calendarSyncState.ownerId, ownerId)));
    if (!s) return;
    const a = await this.account(ownerId, s.accountId);
    if (!a || a.status !== 'active') return;
    const at = await this.accessToken(a);
    let syncToken = s.syncToken ?? undefined;
    const full = !syncToken;
    const seen = new Set<string>();
    let pageToken: string | undefined;
    for (;;) {
      let page: Awaited<ReturnType<GoogleCalendarClient['events']>>;
      try {
        page = await this.google.events(at, s.externalId, {
          syncToken,
          pageToken,
          timeMin: new Date(this.now() - FULL_SYNC_DAYS * 86_400_000).toISOString(),
        });
      } catch (e) {
        if (e instanceof SyncTokenGone && syncToken) {
          // too old: start again from scratch for this calendar
          await this.db
            .update(calendarSyncState)
            .set({ syncToken: null })
            .where(eq(calendarSyncState.calendarId, calendarId));
          return this.syncCalendar(ownerId, calendarId);
        }
        throw e;
      }
      const items = page.items ?? [];
      for (const g of items) seen.add(g.id);
      await this.apply(ownerId, calendarId, items);
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      syncToken = page.nextSyncToken;
      break;
    }
    if (full) {
      // anything we hold for this calendar that Google no longer has is gone
      const held = await this.db
        .select({ id: todayEvents.id, externalId: todayEvents.externalId })
        .from(todayEvents)
        .where(
          and(
            eq(todayEvents.ownerId, ownerId),
            eq(todayEvents.calendarId, calendarId),
            isNull(todayEvents.deletedAt),
            isNotNull(todayEvents.externalId),
          ),
        );
      await this.write(
        ownerId,
        held
          .filter((h) => !seen.has(h.externalId!))
          .map((h) => ({ entity: TODAY_EVENT, entityId: h.id, op: 'delete' as const, fields: {} })),
      );
    }
    await this.db
      .update(calendarSyncState)
      .set({ syncToken: syncToken ?? null, lastSyncedAt: new Date(this.now()) })
      .where(eq(calendarSyncState.calendarId, calendarId));
  }

  /** One page of Google changes → ORVYN, series before their occurrences, matched by Google id (no duplicates). */
  private async apply(ownerId: string, calendarId: string, items: GEvent[]): Promise<void> {
    if (!items.length) return;
    const ids = [
      ...new Set(items.flatMap((g) => [g.id, ...(g.recurringEventId ? [g.recurringEventId] : [])])),
    ];
    const known = await this.db
      .select({ id: todayEvents.id, externalId: todayEvents.externalId, deletedAt: todayEvents.deletedAt })
      .from(todayEvents)
      .where(
        and(
          eq(todayEvents.ownerId, ownerId),
          eq(todayEvents.calendarId, calendarId),
          inArray(todayEvents.externalId, ids),
        ),
      );
    const byGoogle = new Map(known.filter((k) => !k.deletedAt).map((k) => [k.externalId!, k.id]));
    const idOf = (gid: string) => byGoogle.get(gid) ?? eventIdFor(calendarId, gid);
    const tz = (await this.ownerTz(ownerId)) ?? 'UTC';
    const ordered = [...items.filter((g) => !g.recurringEventId), ...items.filter((g) => g.recurringEventId)];
    const changes: Pick<Mutation, 'entity' | 'entityId' | 'op' | 'fields'>[] = [];
    for (const g of ordered) {
      const f = fromGoogle(g, { calendarId, calendarTz: tz, seriesIdOf: idOf });
      const id = idOf(g.id);
      if (!f) {
        if (byGoogle.has(g.id)) changes.push({ entity: TODAY_EVENT, entityId: id, op: 'delete', fields: {} });
        continue;
      }
      changes.push({ entity: TODAY_EVENT, entityId: id, op: 'upsert', fields: f as Record<string, unknown> });
    }
    await this.write(ownerId, changes);
  }

  private async ownerTz(ownerId: string): Promise<string | null> {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, ownerId));
    return s?.tz ?? null;
  }

  // ------------------------------------------------------------------ ORVYN → Google

  @OnEvent('sync.applied', { async: true, promisify: true })
  async onSync(e: SyncApplied): Promise<void> {
    if (serverOrigin.getStore()) return; // our own writes (from Google) never echo back
    try {
      if (e.entity === TODAY_EVENT) {
        await this.queue.add('push', { kind: 'push', ownerId: e.ownerId, eventId: e.entityId });
      } else if (e.entity === TODAY_CALENDAR && e.op === 'upsert') {
        // switched on: catch up now
        const [c] = await this.db
          .select({ provider: todayCalendars.provider, visible: todayCalendars.visible })
          .from(todayCalendars)
          .where(and(eq(todayCalendars.id, e.entityId), eq(todayCalendars.ownerId, e.ownerId)));
        if (c?.provider === 'google' && c.visible)
          await this.queue.add('sync', { kind: 'sync', ownerId: e.ownerId, calendarId: e.entityId });
      }
    } catch (err) {
      this.log.warn(`queue failed: ${(err as Error).message}`);
    }
  }

  private asFields(r: EventRow): EventFields {
    return {
      ...r,
      start: r.start?.toISOString() ?? null,
      end: r.end?.toISOString() ?? null,
    } as unknown as EventFields;
  }

  async pushEvent(ownerId: string, eventId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(todayEvents)
      .where(and(eq(todayEvents.id, eventId), eq(todayEvents.ownerId, ownerId)));
    if (!row?.calendarId) return;
    const [s] = await this.db
      .select()
      .from(calendarSyncState)
      .where(eq(calendarSyncState.calendarId, row.calendarId));
    if (!s) return; // not a provider calendar
    const a = await this.account(ownerId, s.accountId);
    if (!a || a.status !== 'active') return;
    const at = await this.accessToken(a);

    try {
      if (row.deletedAt) {
        if (row.externalId) await this.google.remove(at, s.externalId, row.externalId, row.etag);
        return;
      }
      const body = toGoogle(this.asFields(row));
      let saved: GEvent;
      if (row.recurringEventId) {
        // one occurrence of a series: Google addresses it as <series>_<original start>
        const [series] = await this.db
          .select({ externalId: todayEvents.externalId })
          .from(todayEvents)
          .where(and(eq(todayEvents.id, row.recurringEventId), eq(todayEvents.ownerId, ownerId)));
        if (!series?.externalId || !row.originalStart) return; // the series hasn't reached Google yet: retried later
        delete body.recurrence;
        const target = row.externalId ?? instanceId(series.externalId, row.originalStart);
        saved = await this.google.patch(
          at,
          s.externalId,
          target,
          body,
          row.externalId ? row.etag : undefined,
        );
      } else if (!row.externalId) {
        saved = await this.google.insert(at, s.externalId, body);
      } else {
        saved = await this.google.patch(at, s.externalId, row.externalId, body, row.etag);
      }
      await this.write(ownerId, [
        {
          entity: TODAY_EVENT,
          entityId: row.id,
          op: 'upsert',
          fields: { externalId: saved.id, etag: saved.etag ?? null },
        },
      ]);
    } catch (e) {
      if (e instanceof EtagMismatch) {
        // changed on Google meanwhile: Google's version wins, and the person sees it on every device
        await this.syncCalendar(ownerId, row.calendarId);
        return;
      }
      if (e instanceof GoogleHttpError && e.status === 403) {
        this.log.warn('write refused by Google (read-only calendar?)');
        await this.syncCalendar(ownerId, row.calendarId);
        return;
      }
      throw e;
    }
  }
}
