import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  formatMoney,
  type IpoDecision,
  type IpoEvent,
  type IpoIssueView,
  IpoSettings,
  type IpoSubscription,
  type ManualFigures,
  type NewIssue,
  TODAY_TASK,
} from '@orvyn/contracts';
import { instantAt, wallIn } from '@orvyn/today-parse';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis.module';
import { notFound } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import { type NotifyAction, NotifyService } from '../notify/notify.service';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { todaySettings, todayTasks } from '../today/today.schema';
import { type FeedIssue, IpoFeed } from './feed';
import {
  ipoAlerts,
  ipoApplications,
  ipoDecisions,
  ipoIssues,
  ipoRounds,
  ipoSettings,
  ipoSnapshots,
  ipoStars,
} from './ipo.schema';
import { across, expectedGain, odds, verdict } from './odds';
import { PoolService } from './pool.service';

type Issue = typeof ipoIssues.$inferSelect;
const QUEUE = 'ipo';
const TZ = 'Asia/Kolkata';
const GMP_EVERY_MS = 3 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const SUB_MILESTONES = [1, 10, 50];
const REF = 'ipo:';
/** what each notification button means (spec 0016 A5) */
const ACTION_DECISION: Record<string, IpoDecision> = {
  apply: 'applying',
  skip: 'skipped',
  applied: 'applied',
  allotted: 'allotted',
  missed: 'not_allotted',
};
const ASK = [
  { id: 'apply', label: 'I’ll apply' },
  { id: 'skip', label: 'Skip' },
];

/**
 * The IPO desk (spec 0010 part A): market data from the feed (or typed in), the odds and what the Pool can expect,
 * and notifications filtered the way each person set them.
 */
@Injectable()
export class IpoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ipo');
  private queue?: Queue;
  private worker?: Worker;
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly feed: IpoFeed,
    private readonly pool: PoolService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly sync: SyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.PROCESS_ROLE === 'api') return;
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue(QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 100 },
    });
    this.worker = new Worker(
      QUEUE,
      async () => {
        await this.refresh().catch((e: Error) => this.log.warn(`refresh: ${e.message}`));
        await this.alertAll().catch((e: Error) => this.log.warn(`alerts: ${e.message}`));
      },
      { connection, concurrency: 1 },
    );
    await this.queue
      .upsertJobScheduler(
        'ipo-tick',
        // first tick a minute after start, then every 30 minutes
        { every: 30 * 60_000, startDate: new Date(Date.now() + 60_000) },
        { name: 'tick', data: {} },
      )
      .catch((e: Error) => this.log.warn(`scheduler: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private clock() {
    const w = wallIn(new Date(this.now()), TZ);
    return { today: `${w.y}-${pad(w.m)}-${pad(w.d)}`, hhmm: `${pad(w.h)}:${pad(w.mi)}` };
  }

  // ------------------------------------------------------------------ the feed (ADR-0013)

  /**
   * Spends calls from the day's allowance (IST day) and the minute's (D-0016-1: the free plan allows one a minute);
   * false when either is used up.
   */
  private async spend(n = 1): Promise<boolean> {
    const minute = `ipo:min:${Math.floor(this.now() / 60_000)}`;
    const inMinute = await this.redis.incrby(minute, n);
    if (inMinute === n) await this.redis.expire(minute, 180);
    if (inMinute > this.env.IPO_FEED_PER_MIN) {
      await this.redis.decrby(minute, n);
      return false;
    }
    const key = `ipo:calls:${this.clock().today}`;
    const used = await this.redis.incrby(key, n);
    if (used === n) await this.redis.expire(key, 2 * 86_400);
    if (used > this.env.IPO_FEED_DAILY_CALLS) {
      await this.redis.decrby(key, n);
      await this.redis.decrby(minute, n);
      return false;
    }
    return true;
  }

  /**
   * Called every 30 minutes (D-0016-1): the calendar every 3 hours (every card figure and GMP for every IPO in one
   * call); spare calls fetch the details of open and upcoming IPOs, mainboard first.
   */
  async refresh(): Promise<number> {
    if (!this.feed.ready()) return 0;
    let changed = 0;
    const last = Number((await this.redis.get('ipo:gmp:at')) ?? 0);
    if (this.now() - last >= GMP_EVERY_MS && (await this.spend())) {
      for (const f of await this.feed.current()) changed += await this.upsert(f);
      await this.redis.set('ipo:gmp:at', String(this.now()));
    }
    const stale = new Date(this.now() - (this.feed.hasSubscription() ? 30 : 6 * 60) * 60_000);
    const due = await this.db
      .select()
      .from(ipoIssues)
      .where(
        and(
          eq(ipoIssues.source, this.feed.name),
          inArray(ipoIssues.status, ['open', 'upcoming']),
          or(
            sql`${ipoIssues.detailAt} is null`,
            and(eq(ipoIssues.status, 'open'), lt(ipoIssues.detailAt, stale)),
          ),
        ),
      )
      .orderBy(
        sql`case when ${ipoIssues.type} = 'mainboard' then 0 else 1 end`,
        sql`case when ${ipoIssues.status} = 'open' then 0 else 1 end`,
        sql`${ipoIssues.detailAt} asc nulls first`,
      )
      .limit(5);
    for (const i of due) {
      const cost = this.feed.hasSubscription() && i.status === 'open' ? 2 : 1;
      if (!(await this.spend(cost))) break;
      const f = await this.feed.detail(i.slug).catch((e: Error) => {
        this.log.warn(`detail ${i.slug}: ${e.message}`);
        return null;
      });
      if (f) changed += await this.upsert(f, true);
    }
    return changed;
  }

  /** Keeps typed-in fields; writes a snapshot when GMP or subscription moved. */
  async upsert(f: FeedIssue, detail = false): Promise<number> {
    const [old] = await this.db.select().from(ipoIssues).where(eq(ipoIssues.slug, f.slug));
    const keep = new Set(old?.manual ?? []);
    const pick = <T>(field: string, fresh: T | null, prev: T | null | undefined): T | null =>
      keep.has(field) ? (prev ?? null) : (fresh ?? prev ?? null);
    const values = {
      slug: f.slug,
      name: f.name,
      type: f.type,
      status: f.status,
      openDate: f.openDate ?? old?.openDate ?? null,
      closeDate: f.closeDate ?? old?.closeDate ?? null,
      allotmentDate: f.allotmentDate ?? old?.allotmentDate ?? null,
      refundDate: f.refundDate ?? old?.refundDate ?? null,
      listingDate: f.listingDate ?? old?.listingDate ?? null,
      priceMin: f.priceMin ?? old?.priceMin ?? null,
      priceMax: f.priceMax ?? old?.priceMax ?? null,
      lotSize: f.lotSize ?? old?.lotSize ?? null,
      issueSizeCr: f.issueSizeCr ?? old?.issueSizeCr ?? null,
      gmp: pick('gmp', f.gmp, old?.gmp),
      gmpUpdatedAt: keep.has('gmp')
        ? (old?.gmpUpdatedAt ?? null)
        : f.gmpUpdatedAt
          ? new Date(f.gmpUpdatedAt)
          : (old?.gmpUpdatedAt ?? null),
      subscription: pick('subscription', f.subscription, old?.subscription),
      listingPrice: pick('listingPrice', f.listingPrice, old?.listingPrice),
      logo: f.logo ?? old?.logo ?? null,
      minInvestment: f.minInvestment ?? old?.minInvestment ?? null,
      faceValue: f.faceValue ?? old?.faceValue ?? null,
      listingOn: f.listingOn ?? old?.listingOn ?? null,
      saleType: f.saleType ?? old?.saleType ?? null,
      listingGainPct: f.listingGainPct ?? old?.listingGainPct ?? null,
      cmp: f.cmp ?? old?.cmp ?? null,
      kostak: f.kostak ?? old?.kostak ?? null,
      sauda: f.sauda ?? old?.sauda ?? null,
      details: f.details ?? old?.details ?? null,
      source: old?.source === 'manual' ? 'manual' : this.feed.name,
      sourceUrl: f.url ?? old?.sourceUrl ?? null,
      ...(detail ? { detailAt: new Date(this.now()) } : {}),
    };
    const [row] = await this.db
      .insert(ipoIssues)
      .values(values)
      .onConflictDoUpdate({ target: ipoIssues.slug, set: { ...values, updatedAt: new Date() } })
      .returning();
    const moved =
      !old || old.gmp !== row!.gmp || JSON.stringify(old.subscription) !== JSON.stringify(row!.subscription);
    if (moved && (row!.gmp !== null || row!.subscription))
      await this.db
        .insert(ipoSnapshots)
        .values({ issueId: row!.id, gmp: row!.gmp, subscription: row!.subscription });
    return moved ? 1 : 0;
  }

  // ------------------------------------------------------------------ typed in by hand (no feed, or to correct one)

  async addIssue(b: NewIssue) {
    const slug = `${b.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}-${b.openDate}`;
    const today = this.clock().today;
    const status = b.openDate > today ? 'upcoming' : b.closeDate >= today ? 'open' : 'closed';
    const [row] = await this.db
      .insert(ipoIssues)
      .values({ ...b, slug, status, source: 'manual', manual: [] })
      .onConflictDoNothing()
      .returning();
    if (!row) throw notFound('exists', 'That IPO is already here.');
    return row;
  }

  async setFigures(id: string, m: ManualFigures) {
    const [i] = await this.db.select().from(ipoIssues).where(eq(ipoIssues.id, id));
    if (!i) throw notFound();
    const manual = new Set(i.manual);
    const set: Partial<Issue> = {};
    if (m.gmp !== undefined) {
      set.gmp = m.gmp;
      set.gmpUpdatedAt = new Date(this.now());
      manual.add('gmp');
    }
    if (m.subscription) {
      const s = m.subscription;
      const prev: IpoSubscription = i.subscription ?? {
        total: null,
        qib: null,
        nii: null,
        snii: null,
        bnii: null,
        retail: null,
        employee: null,
        shareholder: null,
        applications: null,
        updatedAt: null,
      };
      set.subscription = {
        ...prev,
        ...Object.fromEntries(
          Object.entries(s).filter(([k, v]) => k !== 'retailApplications' && v !== undefined),
        ),
        applications:
          s.retailApplications !== undefined
            ? { ...(prev.applications ?? {}), retail: s.retailApplications }
            : prev.applications,
        updatedAt: new Date(this.now()).toISOString(),
      };
      manual.add('subscription');
    }
    if (m.listingPrice !== undefined) {
      set.listingPrice = m.listingPrice;
      manual.add('listingPrice');
    }
    const [row] = await this.db
      .update(ipoIssues)
      .set({ ...set, manual: [...manual] })
      .where(eq(ipoIssues.id, id))
      .returning();
    await this.db
      .insert(ipoSnapshots)
      .values({ issueId: id, gmp: row!.gmp, subscription: row!.subscription });
    return row!;
  }

  /** Back to the feed's figures. */
  async clearFigures(id: string) {
    await this.db.update(ipoIssues).set({ manual: [] }).where(eq(ipoIssues.id, id));
  }

  // ------------------------------------------------------------------ reading

  private async view(
    ownerId: string,
    i: Issue,
    starred: boolean,
    withPool: boolean,
    decided?: { decision: IpoDecision; taskId: string | null } | null,
  ): Promise<IpoIssueView> {
    const price = i.priceMax;
    const o = odds({
      type: i.type,
      price,
      lotSize: i.lotSize,
      issueSizeCr: i.issueSizeCr,
      subscription: i.subscription,
    });
    const retail = o.find((x) => x.category === 'retail') ?? null;
    let pool: IpoIssueView['pool'] = null;
    if (withPool && retail && price && i.lotSize && (i.status === 'open' || i.status === 'upcoming')) {
      const r = await this.pool.readiness(ownerId, 'retail', retail.minAmount * 100);
      if (r.accounts > 0) {
        const p = retail.chance;
        const a = p === null ? null : across(r.accounts, p);
        pool = {
          accounts: r.accounts,
          expectedAllotments: a?.expected ?? null,
          chanceAtLeastOne: a?.atLeastOne ?? null,
          expectedGain:
            p !== null && i.gmp !== null
              ? expectedGain({
                  accounts: r.accounts,
                  chance: p,
                  minShares: retail.minLots * i.lotSize,
                  gmp: i.gmp,
                  cardCost: r.cardCostMinor / 100,
                })
              : null,
          cardCost: r.cardCostMinor / 100,
        };
      }
    }
    const gmpPct = i.gmp !== null && price ? (i.gmp / price) * 100 : null;
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      type: i.type,
      status: i.status,
      openDate: i.openDate,
      closeDate: i.closeDate,
      allotmentDate: i.allotmentDate,
      refundDate: i.refundDate,
      listingDate: i.listingDate,
      priceMin: i.priceMin,
      priceMax: i.priceMax,
      lotSize: i.lotSize,
      issueSizeCr: i.issueSizeCr,
      gmp: i.gmp,
      gmpPct,
      gmpUpdatedAt: i.gmpUpdatedAt?.toISOString() ?? null,
      estListingPrice: i.gmp !== null && price ? price + i.gmp : null,
      subscription: i.subscription,
      listingPrice: i.listingPrice,
      minInvestment: i.minInvestment ?? (price && i.lotSize ? price * i.lotSize : null),
      logo: i.logo,
      faceValue: i.faceValue,
      listingOn: i.listingOn,
      saleType: i.saleType,
      listingGainPct:
        i.listingGainPct ?? (i.listingPrice && price ? ((i.listingPrice - price) / price) * 100 : null),
      cmp: i.cmp,
      kostak: i.kostak,
      sauda: i.sauda,
      gainPerLot: i.gmp !== null && i.lotSize ? Math.round(i.gmp * i.lotSize) : null,
      details: i.details,
      decision: decided?.decision ?? null,
      taskId: decided?.taskId ?? null,
      source: i.source,
      sourceUrl: i.source === 'manual' ? null : (this.feed.credit ?? null),
      manual: i.manual,
      starred,
      odds: o,
      pool,
      verdict: verdict({ status: i.status, gmpPct, chance: retail?.chance ?? null, pool }),
    };
  }

  private async stars(ownerId: string) {
    return new Set(
      (
        await this.db.select({ id: ipoStars.issueId }).from(ipoStars).where(eq(ipoStars.ownerId, ownerId))
      ).map((s) => s.id),
    );
  }

  private async decisions(ownerId: string) {
    const rows = await this.db.select().from(ipoDecisions).where(eq(ipoDecisions.ownerId, ownerId));
    return new Map(rows.map((r) => [r.issueId, { decision: r.decision, taskId: r.taskId }]));
  }

  async list(ownerId: string, when: 'current' | 'closed' | 'listed', type?: 'mainboard' | 'sme' | 'all') {
    // mainboard only unless asked (spec 0016 A1)
    const show = type ?? ((await this.settings(ownerId)).showSme ? 'all' : 'mainboard');
    const status =
      when === 'current'
        ? (['open', 'upcoming'] as const)
        : when === 'closed'
          ? (['closed'] as const)
          : (['listed'] as const);
    const rows = await this.db
      .select()
      .from(ipoIssues)
      .where(
        and(inArray(ipoIssues.status, [...status]), ...(show === 'all' ? [] : [eq(ipoIssues.type, show)])),
      )
      .orderBy(when === 'listed' ? desc(ipoIssues.listingDate) : ipoIssues.closeDate)
      .limit(80);
    const starred = await this.stars(ownerId);
    const decided = await this.decisions(ownerId);
    const out: IpoIssueView[] = [];
    for (const r of rows)
      out.push(await this.view(ownerId, r, starred.has(r.id), when === 'current', decided.get(r.id)));
    return {
      show,
      issues: out,
      feed: {
        name: this.feed.name,
        ready: this.feed.ready(),
        credit: this.feed.credit,
        subscription: this.feed.hasSubscription(),
      },
    };
  }

  async detail(ownerId: string, id: string) {
    const [i] = await this.db.select().from(ipoIssues).where(eq(ipoIssues.id, id));
    if (!i) throw notFound();
    const starred = await this.stars(ownerId);
    const history = await this.db
      .select()
      .from(ipoSnapshots)
      .where(eq(ipoSnapshots.issueId, id))
      .orderBy(ipoSnapshots.createdAt)
      .limit(500);
    const [round] = await this.db
      .select({ id: ipoRounds.id })
      .from(ipoRounds)
      .where(and(eq(ipoRounds.ownerId, ownerId), eq(ipoRounds.issueId, id)));
    return {
      ...(await this.view(ownerId, i, starred.has(i.id), true, (await this.decisions(ownerId)).get(i.id))),
      history: history.map((h) => ({
        at: h.createdAt.toISOString(),
        gmp: h.gmp,
        retail: h.subscription?.retail ?? null,
        total: h.subscription?.total ?? null,
      })),
      roundId: round?.id ?? null,
    };
  }

  async star(ownerId: string, id: string, on: boolean) {
    if (on) await this.db.insert(ipoStars).values({ ownerId, issueId: id }).onConflictDoNothing();
    else await this.db.delete(ipoStars).where(and(eq(ipoStars.ownerId, ownerId), eq(ipoStars.issueId, id)));
  }

  // ------------------------------------------------------------------ will you apply? (spec 0016 A5)

  private async auth(ownerId: string) {
    const p = await this.access.principal(ownerId);
    if (!p) throw notFound();
    return { userId: ownerId, deviceId: SERVER_DEVICE, role: p.role, entitlements: p.entitlements };
  }

  /**
   * I'll apply · Skip · Applied · Allotted · Not allotted. "I'll apply" makes one Today task due on the close day at the
   * apply-by time, with a morning reminder; Applied ticks it; Skip (or taking the decision back) removes it.
   */
  async decide(ownerId: string, issueId: string, decision: IpoDecision | null) {
    const [i] = await this.db.select().from(ipoIssues).where(eq(ipoIssues.id, issueId));
    if (!i) throw notFound();
    const [old] = await this.db
      .select()
      .from(ipoDecisions)
      .where(and(eq(ipoDecisions.ownerId, ownerId), eq(ipoDecisions.issueId, issueId)));
    let taskId = old?.taskId ?? null;
    const auth = await this.auth(ownerId);
    const task = async (fields: Record<string, unknown> | null) => {
      if (!taskId) return;
      await this.sync.pushAsServer(auth, [
        fields
          ? { entity: TODAY_TASK, entityId: taskId, op: 'upsert', fields }
          : { entity: TODAY_TASK, entityId: taskId, op: 'delete', fields: {} },
      ]);
    };
    if (decision === 'applying') {
      const alive = taskId
        ? (
            await this.db
              .select({ id: todayTasks.id })
              .from(todayTasks)
              .where(and(eq(todayTasks.id, taskId), sql`${todayTasks.deletedAt} is null`))
          ).length > 0
        : false;
      if (!alive) {
        taskId = randomUUID();
        await this.sync.pushAsServer(auth, [
          { entity: TODAY_TASK, entityId: taskId, op: 'upsert', fields: await this.applyTask(ownerId, i) },
        ]);
      } else await task({ completedAt: null });
    } else if (decision === 'applied' || decision === 'allotted' || decision === 'not_allotted') {
      await task({ completedAt: new Date(this.now()).toISOString() });
    } else if (decision === 'skipped' || decision === null) {
      await task(null);
      taskId = null;
    }
    if (decision === null) {
      await this.db
        .delete(ipoDecisions)
        .where(and(eq(ipoDecisions.ownerId, ownerId), eq(ipoDecisions.issueId, issueId)));
    } else {
      await this.db
        .insert(ipoDecisions)
        .values({ ownerId, issueId, decision, taskId })
        .onConflictDoUpdate({
          target: [ipoDecisions.ownerId, ipoDecisions.issueId],
          set: { decision, taskId, updatedAt: new Date() },
        });
    }
    // the question is answered: its notifications clear everywhere
    for (const reason of [
      `announced:${i.id}`,
      `opens:${i.id}`,
      `decide:last:${i.id}`,
      `decide:allot:${i.id}`,
    ])
      await this.notify.dismissByKey(ownerId, `ipo:${reason}`);
    return { decision, taskId };
  }

  /** "Apply for X IPO", due on the close day at the apply-by time, reminded that morning and half an hour before. */
  private async applyTask(ownerId: string, i: Issue) {
    const s = await this.settings(ownerId);
    const tz = await this.timeZone(ownerId);
    const lot = i.priceMax && i.lotSize ? i.priceMax * i.lotSize : null;
    const notes = [
      [
        i.priceMax
          ? `Price ₹${i.priceMin && i.priceMin !== i.priceMax ? `${i.priceMin}–` : ''}${i.priceMax}`
          : null,
        i.lotSize ? `lot ${i.lotSize} shares` : null,
        lot ? `1 lot ${formatMoney(Math.round(lot * 100))}` : null,
        i.gmp !== null && i.priceMax ? `GMP ₹${i.gmp} (${((i.gmp / i.priceMax) * 100).toFixed(1)}%)` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      i.closeDate ? `Bids close at 5 pm on ${i.closeDate}; approve the UPI mandate the same day.` : null,
      `ORVYN: /ipo/${i.id}`,
    ]
      .filter(Boolean)
      .join('\n');
    const day = i.closeDate ?? i.openDate;
    const [y, m, d] = (day ?? '').split('-').map(Number);
    const [hh, mm] = s.applyBy.split(':').map(Number);
    const dueAt = day ? instantAt(y!, m!, d!, hh!, mm!, tz).toISOString() : null;
    const morning = day ? instantAt(y!, m!, d!, 9, 30, tz).toISOString() : null;
    return {
      title: `Apply for ${i.name} IPO`.slice(0, 500),
      notes,
      dueAt,
      dueDate: dueAt ? null : day,
      timeZone: tz,
      priority: 3,
      tags: ['ipo'],
      source: 'ipo',
      reminders: [
        ...(morning && dueAt && morning < dueAt ? [{ kind: 'at' as const, at: morning }] : []),
        ...(dueAt ? [{ kind: 'before' as const, minutes: 30 }] : []),
      ],
    };
  }

  /** The buttons on IPO notifications (spec 0016 A5). */
  @OnEvent('notify.action', { async: true, promisify: true })
  async onAction(e: NotifyAction): Promise<void> {
    if (e.notification.module !== 'ipo' || !e.notification.ref?.startsWith(REF)) return;
    const decision = ACTION_DECISION[e.actionId];
    if (!decision) return;
    await this.decide(e.ownerId, e.notification.ref.slice(REF.length), decision);
  }

  // ------------------------------------------------------------------ settings and alerts (AC3)

  async settings(ownerId: string): Promise<IpoSettings> {
    const [r] = await this.db.select().from(ipoSettings).where(eq(ipoSettings.ownerId, ownerId));
    const saved = (r?.settings ?? {}) as Partial<IpoSettings>;
    const s = IpoSettings.parse(saved);
    // settings saved before spec 0016 didn't know "decide": it starts on, like every new event
    if (r && saved.applyBy === undefined && !s.events.includes('decide')) s.events.push('decide');
    return s;
  }

  async saveSettings(ownerId: string, s: IpoSettings) {
    await this.db
      .insert(ipoSettings)
      .values({ ownerId, settings: s })
      .onConflictDoUpdate({ target: ipoSettings.ownerId, set: { settings: s, updatedAt: new Date() } });
    return s;
  }

  /** The issues a person's filters let through (starred ones always). */
  passes(s: IpoSettings, i: Issue, starred: boolean): boolean {
    if (starred) return true;
    if (s.onlyStarred) return false;
    if (!s.types.includes(i.type)) return false;
    if (s.minIssueSizeCr > 0 && (i.issueSizeCr ?? 0) < s.minIssueSizeCr) return false;
    if (s.minGmpPct !== null) {
      if (i.gmp === null || !i.priceMax) return false;
      if ((i.gmp / i.priceMax) * 100 < s.minGmpPct) return false;
    }
    return true;
  }

  async alertAll(): Promise<number> {
    const owners = new Set(
      (await this.db.select({ id: ipoSettings.ownerId }).from(ipoSettings)).map((r) => r.id),
    );
    let n = 0;
    for (const id of owners) n += await this.alert(id).catch(() => 0);
    return n;
  }

  /** Looks at every IPO that is live or about to be, and sends what the person's settings ask for — once each. */
  async alert(ownerId: string): Promise<number> {
    const p = await this.access.principal(ownerId);
    if (!p || p.disabled || !p.entitlements.has('ipo')) return 0;
    const s = await this.settings(ownerId);
    const { today, hhmm } = this.clock();
    if (hhmm < '08:00' || hhmm >= '21:30') return 0;
    const [{ n: sentToday } = { n: '0' }] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(ipoAlerts)
      .where(and(eq(ipoAlerts.ownerId, ownerId), eq(ipoAlerts.day, today)));
    let left = s.maxPerDay - Number(sentToday);
    if (left <= 0) return 0;
    const starred = await this.stars(ownerId);
    const live = await this.db
      .select()
      .from(ipoIssues)
      .where(
        or(
          inArray(ipoIssues.status, ['upcoming', 'open', 'closed']),
          and(eq(ipoIssues.status, 'listed'), eq(ipoIssues.listingDate, today)),
        ),
      );
    let sent = 0;
    const on = (e: IpoEvent) => s.events.includes(e);
    const decided = await this.decisions(ownerId);
    const fire = async (
      i: Issue,
      reason: string,
      title: string,
      body: string,
      value: number | null = null,
      extra: {
        actions?: { id: string; label: string; open?: string }[];
        priority?: 'normal' | 'high';
        url?: string;
      } = {},
    ) => {
      if (left <= 0) return;
      const [row] = await this.db
        .insert(ipoAlerts)
        .values({ ownerId, issueId: i.id, day: today, reason, value })
        .onConflictDoNothing()
        .returning();
      if (!row) return;
      await this.notify.send({
        userId: ownerId,
        module: 'ipo',
        kind: 'ipo',
        title,
        body,
        url: extra.url ?? `/ipo/${i.id}`,
        dedupeKey: `ipo:${reason}`,
        ref: `${REF}${i.id}`,
        actions: extra.actions ?? [],
        priority: extra.priority ?? 'normal',
      });
      left--;
      sent++;
    };
    /** "Will you apply?" on the first pings about an IPO I haven't decided on */
    const ask = (i: Issue) =>
      on('decide') && !decided.has(i.id) && i.status !== 'closed' ? { actions: ASK } : {};
    const facts = (i: Issue) =>
      [
        i.issueSizeCr ? `₹${Math.round(i.issueSizeCr).toLocaleString('en-IN')} cr` : null,
        i.priceMax
          ? `₹${i.priceMin && i.priceMin !== i.priceMax ? `${i.priceMin}–` : ''}${i.priceMax}`
          : null,
        i.gmp !== null && i.priceMax ? `GMP ₹${i.gmp} (${((i.gmp / i.priceMax) * 100).toFixed(0)}%)` : null,
        i.priceMax && i.lotSize ? `1 lot ${formatMoney(Math.round(i.priceMax * i.lotSize * 100))}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

    // my own decisions come first, whatever the filters: they are follow-ups I asked for
    if (on('decide'))
      for (const i of live) {
        if (left <= 0) break;
        const d = decided.get(i.id);
        if (!d) continue;
        const lot = i.gmp !== null && i.lotSize ? Math.round(i.gmp * i.lotSize) : null;
        if (d.decision === 'applying' && i.closeDate === today && hhmm >= '10:00') {
          const [t] = d.taskId
            ? await this.db
                .select({ done: todayTasks.completedAt })
                .from(todayTasks)
                .where(eq(todayTasks.id, d.taskId))
            : [];
          if (!t?.done)
            await fire(
              i,
              `decide:last:${i.id}`,
              `Last day for ${i.name} — applied?`,
              'Bids close at 5 pm. Approve the UPI mandate in your bank app too.',
              null,
              {
                actions: [
                  { id: 'applied', label: 'Applied ✓' },
                  { id: 'skip', label: 'Skip it' },
                ],
                priority: 'high',
              },
            );
        }
        if (d.decision === 'applied' && i.allotmentDate && i.allotmentDate <= today && hhmm >= '18:00')
          await fire(
            i,
            `decide:allot:${i.id}`,
            `${i.name}: allotment is out — did you get it?`,
            'Check on the registrar’s page or your bank (the blocked amount is released if not).',
            null,
            {
              actions: [
                { id: 'allotted', label: 'Got it 🎉' },
                { id: 'missed', label: 'Not this time' },
              ],
              url: i.details?.registrar?.statusPage ?? `/ipo/${i.id}`,
            },
          );
        if (d.decision === 'allotted' && i.listingDate === today && hhmm >= '09:15')
          await fire(
            i,
            `decide:listing:${i.id}`,
            `${i.name} lists today at 10 am`,
            i.gmp !== null && lot !== null
              ? `GMP ₹${i.gmp} → about ${lot >= 0 ? '+' : '−'}₹${Math.abs(lot).toLocaleString('en-IN')} on your lot. Decide: sell at the open or hold.`
              : 'Decide: sell at the open or hold.',
            null,
            { priority: 'high' },
          );
      }

    for (const i of live) {
      if (left <= 0) break;
      if (!this.passes(s, i, starred.has(i.id))) continue;
      if (on('announced') && i.status === 'upcoming')
        await fire(
          i,
          `announced:${i.id}`,
          `New IPO: ${i.name}`,
          `${facts(i)}${i.openDate ? ` · opens ${i.openDate}` : ''}${ask(i).actions ? ' · Will you apply?' : ''}`,
          null,
          ask(i),
        );
      if (on('opens') && i.openDate === today && i.status !== 'closed')
        await fire(
          i,
          `opens:${i.id}`,
          `${i.name} opens today`,
          `${facts(i)}${ask(i).actions ? ' · Will you apply?' : ''}`,
          null,
          ask(i),
        );
      if (on('closes') && i.closeDate === today && hhmm >= '09:00')
        await fire(
          i,
          `closes:${i.id}`,
          `Last day: ${i.name}`,
          `${facts(i)}${i.subscription?.retail ? ` · retail ${i.subscription.retail}×` : ''}`,
        );
      if (on('gmp') && i.gmp !== null && i.priceMax && i.status !== 'listed') {
        const pct = (i.gmp / i.priceMax) * 100;
        const [last] = await this.db
          .select()
          .from(ipoAlerts)
          .where(
            and(
              eq(ipoAlerts.ownerId, ownerId),
              eq(ipoAlerts.issueId, i.id),
              sql`${ipoAlerts.reason} like 'gmp:%'`,
            ),
          )
          .orderBy(desc(ipoAlerts.createdAt))
          .limit(1);
        if (!last)
          await this.db
            .insert(ipoAlerts)
            .values({ ownerId, issueId: i.id, day: `base:${today}`, reason: `gmp:${i.id}:base`, value: pct })
            .onConflictDoNothing();
        else if (Math.abs(pct - (last.value ?? 0)) >= s.gmpMovePct)
          await fire(
            i,
            `gmp:${i.id}:${Math.round(pct)}:${today}`,
            `${i.name}: GMP ${pct > (last.value ?? 0) ? 'up' : 'down'} to ${pct.toFixed(0)}%`,
            `₹${i.gmp} over ₹${i.priceMax} · est. listing ₹${i.priceMax + i.gmp}`,
            pct,
          );
      }
      if (on('subscription') && i.subscription?.retail && i.status === 'open') {
        const hit = SUB_MILESTONES.filter((m) => i.subscription!.retail! >= m).pop();
        if (hit)
          await fire(
            i,
            `sub:${i.id}:${hit}`,
            `${i.name}: retail ${hit === 1 ? 'fully subscribed' : `over ${hit}×`}`,
            `Retail ${i.subscription.retail}× · total ${i.subscription.total ?? '—'}×`,
          );
      }
      if (on('allotment') && i.allotmentDate === today && hhmm >= '10:00')
        await fire(i, `allot:${i.id}`, `Allotment today: ${i.name}`, 'Check your accounts this evening.');
      if (on('listing') && i.listingDate === today && hhmm >= '10:05')
        await fire(
          i,
          `listing:${i.id}`,
          `${i.name} lists today`,
          i.listingPrice && i.priceMax
            ? `Listed at ₹${i.listingPrice} (${(((i.listingPrice - i.priceMax) / i.priceMax) * 100).toFixed(1)}%)`
            : facts(i),
        );
    }
    sent += await this.poolNudges(ownerId, today, hhmm);
    return sent;
  }

  /** Your rounds: partners who haven't applied on the last day (AC4's companion). */
  private async poolNudges(ownerId: string, today: string, hhmm: string): Promise<number> {
    if (hhmm < '10:00') return 0;
    const rows = await this.db
      .select({ round: ipoRounds, issue: ipoIssues })
      .from(ipoRounds)
      .innerJoin(ipoIssues, eq(ipoIssues.id, ipoRounds.issueId))
      .where(and(eq(ipoRounds.ownerId, ownerId), eq(ipoIssues.closeDate, today)));
    let n = 0;
    for (const { round, issue } of rows) {
      const waiting = await this.db
        .select({ id: ipoApplications.id })
        .from(ipoApplications)
        .where(
          and(eq(ipoApplications.roundId, round.id), inArray(ipoApplications.status, ['planned', 'funded'])),
        );
      if (!waiting.length) continue;
      const [row] = await this.db
        .insert(ipoAlerts)
        .values({ ownerId, issueId: issue.id, day: today, reason: `pool:closes:${round.id}` })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      await this.notify.send({
        userId: ownerId,
        module: 'ipo',
        kind: 'pool',
        title: `${waiting.length} ${waiting.length === 1 ? 'account hasn’t' : 'accounts haven’t'} applied — ${issue.name} closes today`,
        body: 'Bids close at 5 pm. Nudge them from the round.',
        url: `/ipo/pool/rounds/${round.id}`,
        dedupeKey: `ipo:pool:closes:${round.id}`,
        priority: 'high',
      });
      n++;
    }
    return n;
  }

  /**
   * For the Brief (spec 0016 B1): IPOs with something today — open (opening or closing), allotment or listing — that pass
   * my filters or that I decided on, with the figures that matter.
   */
  async today(ownerId: string, today: string) {
    const s = await this.settings(ownerId);
    const starred = await this.stars(ownerId);
    const decided = await this.decisions(ownerId);
    const rows = await this.db
      .select()
      .from(ipoIssues)
      .where(
        or(
          eq(ipoIssues.status, 'open'),
          eq(ipoIssues.openDate, today),
          eq(ipoIssues.allotmentDate, today),
          eq(ipoIssues.listingDate, today),
        ),
      );
    const out = [];
    for (const i of rows) {
      const d = decided.get(i.id);
      if (!d && !this.passes(s, i, starred.has(i.id))) continue;
      if (!d && i.type === 'sme' && !s.showSme && !starred.has(i.id)) continue;
      const when =
        i.listingDate === today
          ? 'listing'
          : i.allotmentDate === today
            ? 'allotment'
            : i.openDate === today
              ? 'opens'
              : i.closeDate === today
                ? 'closes'
                : 'open';
      if ((when === 'allotment' || when === 'listing') && !d) continue;
      out.push({
        id: i.id,
        name: i.name,
        logo: i.logo,
        today: when as 'opens' | 'closes' | 'open' | 'allotment' | 'listing',
        gmp: i.gmp,
        gmpPct: i.gmp !== null && i.priceMax ? (i.gmp / i.priceMax) * 100 : null,
        lotAmount: i.priceMax && i.lotSize ? i.priceMax * i.lotSize : null,
        gainPerLot: i.gmp !== null && i.lotSize ? Math.round(i.gmp * i.lotSize) : null,
        closeDate: i.closeDate,
        decision: d?.decision ?? null,
      });
    }
    const order = { closes: 0, listing: 1, allotment: 2, opens: 3, open: 4, upcoming: 5 };
    return out.sort((a, b) => order[a.today] - order[b.today]).slice(0, 6);
  }

  /** For Home: open IPOs that pass your filters, with the money line. */
  async open(ownerId: string) {
    const s = await this.settings(ownerId);
    const starred = await this.stars(ownerId);
    const rows = await this.db.select().from(ipoIssues).where(eq(ipoIssues.status, 'open'));
    return rows
      .filter((i) => this.passes(s, i, starred.has(i.id)))
      .map((i) => ({
        id: i.id,
        name: i.name,
        closeDate: i.closeDate,
        gmp: i.gmp,
        line: [
          i.gmp !== null && i.priceMax ? `GMP ${((i.gmp / i.priceMax) * 100).toFixed(0)}%` : null,
          i.subscription?.retail ? `retail ${i.subscription.retail}×` : null,
          i.priceMax && i.lotSize ? formatMoney(Math.round(i.priceMax * i.lotSize * 100)) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }));
  }

  async timeZone(ownerId: string) {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, ownerId));
    return s?.tz ?? TZ;
  }
}
