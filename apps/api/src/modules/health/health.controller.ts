import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis.module';
import { DB, type Db } from '../../db/db.module';
import { Public } from '../auth/auth.decorators';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async health() {
    const [db, redis] = await Promise.all([
      this.db.execute(sql`select 1`).then(
        () => 'ok',
        () => 'down',
      ),
      this.redis.ping().then(
        () => 'ok',
        () => 'down',
      ),
    ]);
    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      db,
      redis,
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
