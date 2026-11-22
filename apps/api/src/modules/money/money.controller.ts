import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DEFAULT_CATEGORIES, MONEY_CATEGORY } from '@orvyn/contracts';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { instantAt, wallIn } from '@orvyn/today-parse';
import { v5 } from 'uuid';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { moneyInsights, type Upcoming } from '@orvyn/money';
import { occurrences } from '@orvyn/today-plan';
import { moneyBudgets, moneyCategories, moneyRecurring, moneyTransactions } from './money.schema';
import { todaySettings } from '../today/today.schema';
import { ReviewService } from './review.service';
import { badRequest, notFound } from '../../common/errors';

const NS = '8f3b2c1d-4e5a-4b6c-9d7e-0f1a2b3c4d5e';

@Controller('money')
@RequireEntitlement('money')
export class MoneyController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: SyncService,
    private readonly review: ReviewService,
  ) {}

  /**
   * This month at a glance, for small clients (the Chrome extension): spent and came in (transfers not counted),
   * the latest entries, and how many captured payments wait for a look (spec 0007 C4).
   */
  @Get('glance')
  async glance(@Auth() a: AuthContext) {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, a.userId));
    const tz = s?.tz ?? 'Asia/Kolkata';
    const w = wallIn(new Date(), tz);
    const from = instantAt(w.y, w.m, 1, 0, 0, tz);
    const to = instantAt(w.y, w.m + 1, 1, 0, 0, tz);
    const mine = and(eq(moneyTransactions.ownerId, a.userId), isNull(moneyTransactions.deletedAt));
    const [totals] = await this.db
      .select({
        spent: sql<number>`coalesce(sum(case when ${moneyTransactions.direction} = 'debit' and not ${moneyTransactions.transfer} then ${moneyTransactions.amountMinor} end), 0)`,
        earned: sql<number>`coalesce(sum(case when ${moneyTransactions.direction} = 'credit' and not ${moneyTransactions.transfer} then ${moneyTransactions.amountMinor} end), 0)`,
      })
      .from(moneyTransactions)
      .where(and(mine, gte(moneyTransactions.occurredAt, from), lt(moneyTransactions.occurredAt, to)));
    const [fresh] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(moneyTransactions)
      .where(and(mine, eq(moneyTransactions.reviewed, false)));
    const recent = await this.db
      .select({
        id: moneyTransactions.id,
        amountMinor: moneyTransactions.amountMinor,
        currency: moneyTransactions.currency,
        direction: moneyTransactions.direction,
        merchant: moneyTransactions.merchant,
        occurredAt: moneyTransactions.occurredAt,
        reviewed: moneyTransactions.reviewed,
        category: moneyCategories.name,
      })
      .from(moneyTransactions)
      .leftJoin(
        moneyCategories,
        and(eq(moneyCategories.id, moneyTransactions.categoryId), eq(moneyCategories.ownerId, a.userId)),
      )
      .where(mine)
      .orderBy(desc(moneyTransactions.occurredAt))
      .limit(8);
    const categories = await this.db
      .select({ id: moneyCategories.id, name: moneyCategories.name, slug: moneyCategories.slug })
      .from(moneyCategories)
      .where(
        and(
          eq(moneyCategories.ownerId, a.userId),
          isNull(moneyCategories.deletedAt),
          eq(moneyCategories.archived, false),
        ),
      );
    return {
      categories,
      month: `${w.y}-${String(w.m).padStart(2, '0')}`,
      spentMinor: Number(totals?.spent ?? 0),
      earnedMinor: Number(totals?.earned ?? 0),
      toReview: Number(fresh?.n ?? 0),
      recent: recent.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
    };
  }

  /**
   * The month, read for the person (spec 0013): pace and forecast, safe to spend, unusual charges, duplicates, price
   * changes, subscriptions not tracked yet, bills this week, top merchants, payments without a category. Rules only.
   */
  @Get('insights')
  async insights(@Auth() a: AuthContext, @Query('month') monthQ?: string) {
    const [s] = await this.db
      .select({ tz: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, a.userId));
    const tz = s?.tz ?? 'Asia/Kolkata';
    const now = new Date();
    const w = wallIn(now, tz);
    const current = `${w.y}-${String(w.m).padStart(2, '0')}`;
    const month = monthQ ?? current;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('bad_month', 'Month is YYYY-MM.');
    const [y, m] = month.split('-').map(Number) as [number, number];
    // this month and the four before it: enough for usual amounts and subscriptions
    const from = instantAt(y, m - 4, 1, 0, 0, tz);
    const to = instantAt(y, m + 1, 1, 0, 0, tz);
    const rows = await this.db
      .select()
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.ownerId, a.userId),
          isNull(moneyTransactions.deletedAt),
          gte(moneyTransactions.occurredAt, from),
          lt(moneyTransactions.occurredAt, to),
        ),
      )
      .limit(5000);
    const budgets = await this.db
      .select()
      .from(moneyBudgets)
      .where(and(eq(moneyBudgets.ownerId, a.userId), isNull(moneyBudgets.deletedAt)));
    const overall = budgets
      .filter((b) => !b.archived && b.categoryId === null && b.from <= month)
      .sort((p, q) => q.from.localeCompare(p.from))[0];
    const recurring = await this.db
      .select()
      .from(moneyRecurring)
      .where(and(eq(moneyRecurring.ownerId, a.userId), isNull(moneyRecurring.deletedAt)));
    // still to come this month: from tomorrow (today's may already be in) to the month's end
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const upcoming: Upcoming[] = [];
    for (const r of recurring.filter((r) => !r.paused)) {
      try {
        for (const o of occurrences(
          r.rrule,
          { date: r.startDate, timeZone: r.timeZone },
          new Date(`${month === current ? tomorrow : `${month}-01`}T00:00:00Z`),
          new Date(`${monthEnd}T00:00:00Z`),
        ))
          if (!r.endDate || o.date! <= r.endDate)
            upcoming.push({
              title: r.title,
              amountMinor: r.amountMinor,
              direction: r.direction as 'debit',
              date: o.date!,
            });
      } catch {
        /* a rule ORVYN can't read: skip it */
      }
    }
    return moneyInsights({
      txs: rows.map((t) => ({
        id: t.id,
        amountMinor: t.amountMinor,
        direction: t.direction as 'debit' | 'credit',
        occurredAt: t.occurredAt.toISOString(),
        merchant: t.merchant,
        categoryId: t.categoryId,
        transfer: t.transfer,
        accountId: t.accountId,
        dedupeKey: t.dedupeKey,
      })),
      month,
      timeZone: tz,
      now,
      budgetMinor: overall?.amountMinor ?? null,
      upcoming,
      tracked: recurring.flatMap((r) => [r.title, r.merchant].filter(Boolean)),
    });
  }

  /** What ORVYN learned about merchants from the person's answers (spec 0007 C1). */
  @Get('rules')
  rules(@Auth() a: AuthContext) {
    return this.review.rules(a.userId);
  }

  @Delete('rules/:id')
  @HttpCode(204)
  async removeRule(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.review.removeRule(a.userId, id))) throw notFound();
  }

  /**
   * The starting categories, once per person (ids derived from the person and the slug, so two devices asking at
   * the same moment converge on the same rows). Renamed, hidden or deleted ones are never brought back.
   */
  @Post('setup')
  @HttpCode(200)
  async setup(@Auth() a: AuthContext) {
    const ids = DEFAULT_CATEGORIES.map((c) => v5(`${a.userId}|${c.slug}`, NS));
    const [any] = await this.db
      .select({ id: moneyCategories.id })
      .from(moneyCategories)
      .where(and(eq(moneyCategories.ownerId, a.userId)));
    if (any) return { created: 0 };
    await this.sync.pushAsServer(
      { ...a, deviceId: SERVER_DEVICE },
      DEFAULT_CATEGORIES.map((c, i) => ({
        entity: MONEY_CATEGORY,
        entityId: ids[i]!,
        op: 'upsert' as const,
        fields: { name: c.name, kind: c.kind, icon: c.icon, colour: c.colour, order: i, slug: c.slug },
      })),
    );
    return { created: DEFAULT_CATEGORIES.length };
  }
}
