import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BriefSettings,
  type BriefSection,
  type BriefView,
  formatMoney,
  type NudgeKind,
  TODAY_TASK,
} from '@orvyn/contracts';
import { addDays, instantAt, wallIn } from '@orvyn/today-parse';
import { expandEvents, taskDayIn } from '@orvyn/today-plan';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../db/db.module';
import { AccessService } from '../access/access.service';
import type { AuthContext } from '../auth/auth.decorators';
import { ConnectionsService } from '../connections/connections.service';
import { dropItems } from '../drop/drop.schema';
import { libraryDocs } from '../library/library.schema';
import { moneyBudgets, moneyCategories, moneyTransactions } from '../money/money.schema';
import { type NotifyAction, NotifyService } from '../notify/notify.service';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { todayCalendars, todayEvents, todaySettings, todayTasks } from '../today/today.schema';
import { wordsFor } from './brief.compose';
import { briefNudges, briefSettings, briefs } from './brief.schema';

type Job = { kind: 'brief'; ownerId: string } | { kind: 'nudges' };
const QUEUE = 'brief';
/** each section needs its module (ADR-0005) */
const NEEDS: Record<BriefSection['kind'], string> = {
  agenda: 'today',
  money: 'money',
  drop: 'drop',
  library: 'library',
  work: 'today',
  mail: 'today',
};
const NUDGES_UNTIL = '20:00';
const OUTSIDE_TIMEOUT_MS = 20_000;
const pad = (x: number) => String(x).padStart(2, '0');

/** Within a time limit, or nothing: a slow mailbox never holds up the Brief. */
async function within<T>(p: Promise<T>, fallback: T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((r) => {
        t = setTimeout(() => r(fallback), OUTSIDE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The Brief (spec 0009): one calm look at the day at the time the person chose, and a few nudges with strict rules.
 * Written by rules from data already in ORVYN (D-0009-2); reads other modules read-only like the Assistant, and
 * writes only its own tables and, on a tap, through sync.
 */
@Injectable()
export class BriefService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('brief');
  private queue?: Queue<Job>;
  private worker?: Worker<Job>;
  now: () => number = Date.now;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly sync: SyncService,
    private readonly connections: ConnectionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.env.REDIS_URL };
    this.queue = new Queue<Job>(QUEUE, {
      connection,
      defaultJobOptions: { attempts: 2, removeOnComplete: 100, removeOnFail: 200 },
    });
    if (this.env.PROCESS_ROLE === 'api') return;
    this.worker = new Worker<Job>(
      QUEUE,
      async (job) => {
        if (job.data.kind === 'brief') await this.send(job.data.ownerId);
        else await this.nudgeAll();
      },
      { connection, concurrency: 2 },
    );
    this.worker.on('failed', (j, e) => this.log.warn(`${j?.name} failed: ${e.message}`));
    try {
      await this.queue.upsertJobScheduler(
        'brief-nudges',
        { every: 30 * 60_000 },
        { name: 'nudges', data: { kind: 'nudges' } },
      );
      for (const s of await this.db.select().from(briefSettings)) await this.schedule(s.ownerId, s.settings);
    } catch (e) {
      this.log.warn(`schedulers: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  // ------------------------------------------------------------------ settings

  async settings(ownerId: string): Promise<BriefSettings> {
    const [r] = await this.db.select().from(briefSettings).where(eq(briefSettings.ownerId, ownerId));
    return BriefSettings.parse(r?.settings ?? {});
  }

  async saveSettings(ownerId: string, s: BriefSettings): Promise<BriefSettings> {
    await this.db
      .insert(briefSettings)
      .values({ ownerId, settings: s })
      .onConflictDoUpdate({ target: briefSettings.ownerId, set: { settings: s, updatedAt: new Date() } });
    await this.schedule(ownerId, s);
    return s;
  }

  /** The Brief's own scheduler, in the person's zone (moves when the time or the zone changes). */
  private async schedule(ownerId: string, s: BriefSettings): Promise<void> {
    if (!this.queue) return;
    const id = `brief-${ownerId}`;
    if (!s.enabled) {
      await this.queue.removeJobScheduler(id);
      return;
    }
    const [h, m] = s.at.split(':').map(Number) as [number, number];
    await this.queue.upsertJobScheduler(
      id,
      { pattern: `${m} ${h} * * *`, tz: await this.tz(ownerId) },
      { name: 'brief', data: { kind: 'brief', ownerId } },
    );
  }

  /** Today's morning summary (spec 0002 M3) steps aside when the Brief is on, so nothing arrives twice (AC3). */
  @OnEvent('today.digest.replaced', { async: true, promisify: true })
  async replacesDigest(e: { ownerId: string }): Promise<boolean> {
    const p = await this.access.principal(e.ownerId);
    if (!p?.entitlements.has('brief')) return false;
    return (await this.settings(e.ownerId)).enabled;
  }

  // ------------------------------------------------------------------ building

  private async tz(ownerId: string): Promise<string> {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, ownerId));
    return s?.tz ?? 'Asia/Kolkata';
  }

  private clock(tz: string) {
    const now = new Date(this.now());
    const w = wallIn(now, tz);
    const today = `${w.y}-${pad(w.m)}-${pad(w.d)}`;
    return {
      now,
      tz,
      today,
      hhmm: `${pad(w.h)}:${pad(w.mi)}`,
      month: today.slice(0, 7),
      dayStart: instantAt(w.y, w.m, w.d, 0, 0, tz),
      dayEnd: instantAt(w.y, w.m, w.d + 1, 0, 0, tz),
      yesterdayStart: instantAt(w.y, w.m, w.d - 1, 0, 0, tz),
      monthStart: instantAt(w.y, w.m, 1, 0, 0, tz),
      monthEnd: instantAt(w.y, w.m + 1, 1, 0, 0, tz),
      /** share of the month still ahead (0–1) */
      monthLeft: 1 - (w.d - 1) / new Date(Date.UTC(w.y, w.m, 0)).getUTCDate(),
      time: (iso: string) => {
        const x = wallIn(new Date(iso), tz);
        return `${pad(x.h)}:${pad(x.mi)}`;
      },
    };
  }

  async build(ownerId: string): Promise<BriefView> {
    const p = await this.access.principal(ownerId);
    const s = await this.settings(ownerId);
    const c = this.clock(await this.tz(ownerId));
    const want = (k: BriefSection['kind']) =>
      s.sections.includes(k) && !!p?.entitlements.has(NEEDS[k] as never);
    const sections: BriefSection[] = [];

    if (want('agenda')) sections.push(await this.agenda(ownerId, c));
    if (want('money')) {
      const m = await this.money(ownerId, c);
      if (m.yesterdayMinor || m.monthMinor || m.budgets.length || m.toReview) sections.push(m);
    }
    if (want('drop')) {
      const waiting = await this.dropWaiting(ownerId);
      if (waiting) sections.push({ kind: 'drop', waiting });
    }
    if (want('library')) {
      const until = addDays(c.today, 30);
      const docs = await this.db
        .select({ id: libraryDocs.id, title: libraryDocs.title, expiresOn: libraryDocs.expiresOn })
        .from(libraryDocs)
        .where(
          and(
            eq(libraryDocs.ownerId, ownerId),
            isNull(libraryDocs.deletedAt),
            gte(libraryDocs.expiresOn, c.today),
            lte(libraryDocs.expiresOn, until),
          ),
        )
        .orderBy(libraryDocs.expiresOn)
        .limit(5);
      if (docs.length)
        sections.push({
          kind: 'library',
          expiring: docs.map((d) => ({
            id: d.id,
            title: d.title || 'Document',
            expiresOn: d.expiresOn!,
            days: Math.round((Date.parse(d.expiresOn!) - Date.parse(c.today)) / 86_400_000),
          })),
        });
    }
    if (want('work')) {
      const [gh, cu] = await Promise.all([
        within(this.connections.githubWork(ownerId), []),
        within(this.connections.clickupTasks(ownerId), []),
      ]);
      if (gh.length || cu.length)
        sections.push({
          kind: 'work',
          issues: gh.filter((w) => w.kind === 'issue').length,
          reviews: gh.filter((w) => w.kind === 'review').length,
          clickup: cu.length,
          clickupDueToday: cu.filter((t) => t.due && new Date(t.due) < c.dayEnd).length,
        });
    }
    if (want('mail')) {
      const boxes = await within(this.connections.mail(ownerId), []);
      if (boxes.length)
        sections.push({
          kind: 'mail',
          unread: boxes.reduce((a, b) => a + b.unread, 0),
          boxes: boxes.map((b) => ({ account: b.account, unread: b.unread })),
        });
    }
    return {
      day: c.today,
      generatedAt: c.now.toISOString(),
      ...wordsFor(sections, c.time),
      sections,
    };
  }

  private async openTasks(ownerId: string) {
    return this.db
      .select()
      .from(todayTasks)
      .where(
        and(eq(todayTasks.ownerId, ownerId), isNull(todayTasks.deletedAt), isNull(todayTasks.completedAt)),
      );
  }

  private async agenda(ownerId: string, c: ReturnType<BriefService['clock']>): Promise<BriefSection> {
    const tasks = await this.openTasks(ownerId);
    const like = (t: (typeof tasks)[number]) => ({
      ...t,
      dueAt: t.dueAt?.toISOString() ?? null,
      scheduledStart: t.scheduledStart?.toISOString() ?? null,
      completedAt: null,
    });
    const dated = tasks
      .map((t) => ({ t, day: taskDayIn(like(t) as never, c.tz) }))
      .filter((x): x is { t: (typeof tasks)[number]; day: string } => !!x.day && x.day <= c.today);
    const events = await this.db
      .select()
      .from(todayEvents)
      .where(and(eq(todayEvents.ownerId, ownerId), isNull(todayEvents.deletedAt)));
    const hidden = await this.db
      .select({ id: todayCalendars.id })
      .from(todayCalendars)
      .where(and(eq(todayCalendars.ownerId, ownerId), eq(todayCalendars.visible, false)));
    const instances = expandEvents(
      events.map((e) => ({
        ...e,
        start: e.start?.toISOString() ?? null,
        end: e.end?.toISOString() ?? null,
        exdates: e.exdates ?? [],
      })) as never,
      c.dayStart,
      c.dayEnd,
      new Set(hidden.map((h) => h.id)),
    );
    return {
      kind: 'agenda',
      events: instances
        .filter((i) => i.allDay || !i.end || Date.parse(i.end) > c.now.getTime() - 3_600_000)
        .slice(0, 12)
        .map((i) => ({
          title: i.title,
          at: i.start,
          until: i.end,
          allDay: i.allDay,
          location: i.location || null,
        })),
      dueToday: dated.filter((x) => x.day === c.today).length,
      overdue: dated.filter((x) => x.day < c.today).length,
      top: dated
        .sort((a, b) => b.t.priority - a.t.priority || a.day.localeCompare(b.day))
        .slice(0, 5)
        .map((x) => ({ id: x.t.id, title: x.t.title, priority: x.t.priority, overdue: x.day < c.today })),
    };
  }

  private async spent(ownerId: string, from: Date, to: Date, categoryId?: string | null): Promise<number> {
    const [r] = await this.db
      .select({ s: sql<string>`coalesce(sum(${moneyTransactions.amountMinor}), 0)` })
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.ownerId, ownerId),
          isNull(moneyTransactions.deletedAt),
          eq(moneyTransactions.direction, 'debit'),
          eq(moneyTransactions.transfer, false),
          gte(moneyTransactions.occurredAt, from),
          lt(moneyTransactions.occurredAt, to),
          ...(categoryId ? [eq(moneyTransactions.categoryId, categoryId)] : []),
        ),
      );
    return Number(r?.s ?? 0);
  }

  /** Budgets this month with what went against them (the latest budget per category that has started). */
  private async budgets(ownerId: string, c: ReturnType<BriefService['clock']>) {
    const rows = await this.db
      .select({
        id: moneyBudgets.id,
        categoryId: moneyBudgets.categoryId,
        amountMinor: moneyBudgets.amountMinor,
        from: moneyBudgets.from,
        name: moneyCategories.name,
      })
      .from(moneyBudgets)
      .leftJoin(moneyCategories, eq(moneyCategories.id, moneyBudgets.categoryId))
      .where(
        and(
          eq(moneyBudgets.ownerId, ownerId),
          isNull(moneyBudgets.deletedAt),
          eq(moneyBudgets.archived, false),
          lte(moneyBudgets.from, c.month),
        ),
      )
      .orderBy(desc(moneyBudgets.from));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.categoryId ?? '')) latest.set(r.categoryId ?? '', r);
    const out: { id: string; name: string; spentMinor: number; amountMinor: number }[] = [];
    for (const b of latest.values())
      out.push({
        id: b.id,
        name: b.categoryId ? (b.name ?? 'Budget') : 'Everything',
        amountMinor: b.amountMinor,
        spentMinor: await this.spent(ownerId, c.monthStart, c.monthEnd, b.categoryId),
      });
    return out;
  }

  private async toReview(ownerId: string, before?: Date): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.ownerId, ownerId),
          isNull(moneyTransactions.deletedAt),
          eq(moneyTransactions.reviewed, false),
          ...(before ? [lt(moneyTransactions.occurredAt, before)] : []),
        ),
      );
    return Number(r?.n ?? 0);
  }

  private async money(ownerId: string, c: ReturnType<BriefService['clock']>) {
    const budgets = await this.budgets(ownerId, c);
    return {
      kind: 'money' as const,
      yesterdayMinor: await this.spent(ownerId, c.yesterdayStart, c.dayStart),
      monthMinor: await this.spent(ownerId, c.monthStart, c.monthEnd),
      budgets: budgets
        .filter((b) => b.amountMinor > 0 && b.spentMinor >= b.amountMinor * 0.8)
        .map(({ name, spentMinor, amountMinor }) => ({ name, spentMinor, amountMinor })),
      toReview: await this.toReview(ownerId),
    };
  }

  private async dropWaiting(ownerId: string, before?: Date): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(dropItems)
      .where(
        and(
          eq(dropItems.ownerId, ownerId),
          isNull(dropItems.deletedAt),
          notInArray(dropItems.status, ['done', 'kept', 'dismissed']),
          ...(before ? [lt(dropItems.createdAt, before)] : []),
        ),
      );
    return Number(r?.n ?? 0);
  }

  // ------------------------------------------------------------------ reading and sending

  private async store(ownerId: string, view: BriefView, sent = false) {
    await this.db
      .insert(briefs)
      .values({ ownerId, day: view.day, content: view, sentAt: sent ? new Date(this.now()) : null })
      .onConflictDoUpdate({
        target: [briefs.ownerId, briefs.day],
        set: { content: view, updatedAt: new Date(), ...(sent ? { sentAt: new Date(this.now()) } : {}) },
      });
  }

  /** Today's Brief: the stored one, or a fresh one (refresh builds it again). */
  async today(ownerId: string, refresh = false): Promise<BriefView> {
    const { today } = this.clock(await this.tz(ownerId));
    if (!refresh) {
      const [r] = await this.db
        .select()
        .from(briefs)
        .where(and(eq(briefs.ownerId, ownerId), eq(briefs.day, today)));
      if (r) return r.content;
    }
    const view = await this.build(ownerId);
    await this.store(ownerId, view);
    return view;
  }

  async history(ownerId: string, days: number): Promise<BriefView[]> {
    const rows = await this.db
      .select({ content: briefs.content })
      .from(briefs)
      .where(eq(briefs.ownerId, ownerId))
      .orderBy(desc(briefs.day))
      .limit(days);
    return rows.map((r) => r.content);
  }

  /** The scheduled moment: build, keep and send today's Brief — once (AC2). */
  async send(ownerId: string): Promise<boolean> {
    const p = await this.access.principal(ownerId);
    if (!p || p.disabled || !p.entitlements.has('brief')) return false;
    if (!(await this.settings(ownerId)).enabled) return false;
    const { today } = this.clock(await this.tz(ownerId));
    const [done] = await this.db
      .select({ sentAt: briefs.sentAt })
      .from(briefs)
      .where(and(eq(briefs.ownerId, ownerId), eq(briefs.day, today)));
    if (done?.sentAt) return false;
    const view = await this.build(ownerId);
    await this.store(ownerId, view, true);
    await this.notify.send({
      userId: ownerId,
      module: 'brief',
      kind: 'brief',
      title:
        view.headline === 'A clear day' ? 'Good morning — a clear day' : `Good morning — ${view.headline}`,
      body: view.line,
      url: '/brief',
      dedupeKey: `brief:${today}`,
      priority: 'normal',
    });
    return true;
  }

  // ------------------------------------------------------------------ nudges (D-0009-3)

  async nudgeAll(): Promise<number> {
    let n = 0;
    for (const s of await this.db.select({ ownerId: briefSettings.ownerId }).from(briefSettings)) {
      try {
        n += await this.nudge(s.ownerId);
      } catch (e) {
        this.log.warn(`nudges ${s.ownerId}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  /** Looks once for each kind, in order, until the day's cap; sends what it finds. Returns how many it sent. */
  async nudge(ownerId: string): Promise<number> {
    const p = await this.access.principal(ownerId);
    const s = await this.settings(ownerId);
    if (!p || p.disabled || !p.entitlements.has('brief') || !s.enabled || !s.nudges.enabled) return 0;
    const c = this.clock(await this.tz(ownerId));
    if (c.hhmm < s.at || c.hhmm >= NUDGES_UNTIL) return 0;
    const [brief] = await this.db
      .select({ sentAt: briefs.sentAt })
      .from(briefs)
      .where(and(eq(briefs.ownerId, ownerId), eq(briefs.day, c.today)));
    if (!brief?.sentAt) return 0;
    const [{ n: already } = { n: '0' }] = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(briefNudges)
      .where(and(eq(briefNudges.ownerId, ownerId), eq(briefNudges.day, c.today)));
    let left = s.nudges.max - Number(already);
    let sent = 0;
    const on = (k: NudgeKind, module: string) =>
      left > 0 && s.nudges.kinds.includes(k) && p.entitlements.has(module as never);
    const fire = async (kind: NudgeKind, reason: string, n: Parameters<NotifyService['send']>[0]) => {
      const [row] = await this.db
        .insert(briefNudges)
        .values({ ownerId, day: c.today, kind, reason })
        .onConflictDoNothing()
        .returning();
      if (!row) return;
      await this.notify.send(n);
      left--;
      sent++;
    };
    const dayAgo = new Date(c.now.getTime() - 86_400_000);

    if (on('slipped', 'today')) {
      const late = await this.overdue(ownerId, c);
      if (late.length >= 3)
        await fire('slipped', `slipped:${c.today}`, {
          userId: ownerId,
          module: 'brief',
          kind: 'nudge',
          title: `${late.length} things slipped`,
          body: `${late
            .slice(0, 3)
            .map((t) => t.title)
            .join(' · ')}${late.length > 3 ? ` · +${late.length - 3} more` : ''}. Move them to today?`,
          url: '/today',
          ref: `brief.nudge:slipped:${c.today}`,
          dedupeKey: `brief:nudge:slipped:${c.today}`,
          actions: [
            { id: 'move_today', label: 'Move to today' },
            { id: 'open', label: 'Open Today', open: '/today' },
          ],
        });
    }
    if (on('budget', 'money')) {
      for (const b of await this.budgets(ownerId, c)) {
        if (left <= 0 || b.amountMinor <= 0) break;
        const ratio = b.spentMinor / b.amountMinor;
        const level = ratio >= 1 ? 100 : ratio >= 0.8 && c.monthLeft > 0.3 ? 80 : 0;
        if (!level) continue;
        await fire('budget', `budget:${c.month}:${b.id}:${level}`, {
          userId: ownerId,
          module: 'brief',
          kind: 'nudge',
          title:
            level === 100
              ? `${b.name}: budget used up`
              : `${b.name}: ${Math.round(ratio * 100)}% of the budget`,
          body: `${formatMoney(b.spentMinor)} of ${formatMoney(b.amountMinor)} this month${
            level === 80 ? `, with ${Math.round(c.monthLeft * 100)}% of the month to go` : ''
          }.`,
          url: '/money',
          dedupeKey: `brief:nudge:budget:${b.id}:${c.month}`,
          actions: [{ id: 'open', label: 'Open Money', open: '/money' }],
        });
      }
    }
    if (on('payments', 'money')) {
      const waiting = await this.toReview(ownerId, dayAgo);
      if (waiting >= 5)
        await fire('payments', `payments:${c.today}`, {
          userId: ownerId,
          module: 'brief',
          kind: 'nudge',
          title: `${waiting} payments wait for a look`,
          body: 'A minute in Money keeps your month right.',
          url: '/money',
          dedupeKey: `brief:nudge:payments:${c.today}`,
          actions: [{ id: 'open', label: 'Open Money', open: '/money' }],
        });
    }
    if (on('drop', 'drop')) {
      const waiting = await this.dropWaiting(ownerId, dayAgo);
      if (waiting >= 3)
        await fire('drop', `drop:${c.today}`, {
          userId: ownerId,
          module: 'brief',
          kind: 'nudge',
          title: `${waiting} things wait in Drop`,
          body: 'Each needs one tap: add it, keep it or let it go.',
          url: '/drop',
          dedupeKey: `brief:nudge:drop:${c.today}`,
          actions: [{ id: 'open', label: 'Open Drop', open: '/drop' }],
        });
    }
    return sent;
  }

  private async overdue(ownerId: string, c: ReturnType<BriefService['clock']>) {
    const tasks = await this.openTasks(ownerId);
    return tasks
      .filter((t) => {
        const day = taskDayIn(
          {
            ...t,
            dueAt: t.dueAt?.toISOString() ?? null,
            scheduledStart: t.scheduledStart?.toISOString() ?? null,
            completedAt: null,
          } as never,
          c.tz,
        );
        return !!day && day < c.today && !t.rrule;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /** "Move to today" on a slipped nudge: the overdue tasks get today's date (a time keeps its hour), through sync. */
  @OnEvent('notify.action', { async: true, promisify: true })
  async onAction(e: NotifyAction): Promise<void> {
    if (e.notification.module !== 'brief' || !e.notification.ref?.startsWith('brief.nudge:slipped:')) return;
    if (e.actionId !== 'move_today') return;
    const p = await this.access.principal(e.ownerId);
    if (!p?.entitlements.has('today')) return;
    const c = this.clock(await this.tz(e.ownerId));
    const late = await this.overdue(e.ownerId, c);
    if (!late.length) return;
    const [y, m, d] = c.today.split('-').map(Number) as [number, number, number];
    const auth: AuthContext = {
      userId: e.ownerId,
      deviceId: SERVER_DEVICE,
      role: p.role,
      entitlements: p.entitlements,
    };
    await this.sync.pushAsServer(
      auth,
      late.map((t) => {
        const at = t.dueAt ? wallIn(t.dueAt, c.tz) : null;
        return {
          entity: TODAY_TASK,
          entityId: t.id,
          op: 'upsert' as const,
          fields: at
            ? {
                dueAt: instantAt(y, m, d, at.h, at.mi, c.tz).toISOString(),
                dueDate: null,
                scheduledStart: null,
              }
            : { dueDate: c.today, scheduledStart: null },
        };
      }),
    );
  }

  /** Tests: nothing else should touch these. */
  async forgetNudges(ownerId: string): Promise<void> {
    await this.db.delete(briefNudges).where(inArray(briefNudges.ownerId, [ownerId]));
  }
}
