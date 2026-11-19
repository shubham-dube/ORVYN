import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DEFAULT_CATEGORIES, MONEY_CATEGORY } from '@orvyn/contracts';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { instantAt, wallIn } from '@orvyn/today-parse';
import { v5 } from 'uuid';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { moneyCategories, moneyTransactions } from './money.schema';
import { todaySettings } from '../today/today.schema';
import { ReviewService } from './review.service';
import { notFound } from '../../common/errors';

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
