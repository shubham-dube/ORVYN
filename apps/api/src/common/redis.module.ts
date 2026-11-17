import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisCloser implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** True when `key` has already used up `limit` hits in its current window (does not count this call). */
  async over(key: string, limit: number): Promise<boolean> {
    return Number((await this.redis.get(`rl:${key}`)) ?? 0) >= limit;
  }

  /** Fixed-window limit. Returns false when the caller is over the limit. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const k = `rl:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSeconds);
    return n <= limit;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }),
    },
    RedisCloser,
    RateLimiter,
  ],
  exports: [REDIS, RateLimiter],
})
export class RedisModule {}
