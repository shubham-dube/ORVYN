import { Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { DEFAULT_CATEGORIES, MONEY_CATEGORY } from '@orvyn/contracts';
import { and, eq } from 'drizzle-orm';
import { v5 } from 'uuid';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { SERVER_DEVICE, SyncService } from '../sync/sync.service';
import { moneyCategories } from './money.schema';

const NS = '8f3b2c1d-4e5a-4b6c-9d7e-0f1a2b3c4d5e';

@Controller('money')
@RequireEntitlement('money')
export class MoneyController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: SyncService,
  ) {}

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
