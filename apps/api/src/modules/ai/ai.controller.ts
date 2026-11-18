import { Controller, Get, Query } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, OwnerOnly } from '../auth/auth.decorators';
import { users } from '../auth/auth.schema';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Whether AI work is running or paused for today (shown next to waiting items). */
  @Get('status')
  status(@Auth() a: AuthContext) {
    return this.ai.status(a.userId);
  }

  /** What the model has cost me: by day and by task, for the last N days (default 14), against today's limits. */
  @Get('usage')
  async usage(@Auth() a: AuthContext, @Query('days') days?: string) {
    const [u, status] = await Promise.all([
      this.ai.usage({ ownerId: a.userId, days: days ? Number(days) : undefined }),
      this.ai.status(a.userId),
    ]);
    return { ...u, status };
  }

  /** Everyone's usage (owner only): totals by day and task, and who used what today. */
  @OwnerOnly()
  @Get('usage/all')
  async usageAll(@Query('days') days?: string) {
    const [u, today] = await Promise.all([
      this.ai.usage({ days: days ? Number(days) : undefined }),
      this.ai.todayByPerson(),
    ]);
    const ids = today.flatMap((t) => (t.ownerId ? [t.ownerId] : []));
    const rows = ids.length
      ? await this.db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    return {
      ...u,
      capUsd: (await this.ai.status('00000000-0000-0000-0000-000000000000')).capUsd,
      todayByPerson: today.map((t) => ({
        ...t,
        person:
          rows.find((r) => r.id === t.ownerId)?.name ||
          rows.find((r) => r.id === t.ownerId)?.email ||
          'System',
      })),
    };
  }
}
