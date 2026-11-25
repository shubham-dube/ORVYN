import { Body, Controller, Delete, Get, HttpCode, Module, Post, Put, Query } from '@nestjs/common';
import { ActivityPush, ActivityRules } from '@orvyn/contracts';
import { z } from 'zod';
import { Seal } from '../../common/seal';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ActivityService, isTimeZone } from './activity.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zone = z.string().max(60).refine(isTimeZone, 'unknown time zone').default('Asia/Kolkata');
const DayQuery = z.object({ date: day, tz: zone });
const RangeQuery = z.object({ from: day, to: day, tz: zone });
const instant = z.string().datetime({ offset: true });
const Window = z.object({ from: instant, to: instant });

/** My Day (spec 0020). Only ever the caller's own record; there is no admin view (ADR-0018). */
@Controller('activity')
@RequireEntitlement('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Post('spans')
  @HttpCode(200)
  push(@Auth() a: AuthContext, @Body(new ZodPipe(ActivityPush)) b: ActivityPush) {
    return this.activity.push(a.userId, a.deviceId, b.spans);
  }

  @Get('day')
  day(@Auth() a: AuthContext, @Query(new ZodPipe(DayQuery)) q: { date: string; tz: string }) {
    return this.activity.day(a.userId, q.date, q.tz);
  }

  @Get('range')
  range(@Auth() a: AuthContext, @Query(new ZodPipe(RangeQuery)) q: { from: string; to: string; tz: string }) {
    return this.activity.range(a.userId, q.from, q.to, q.tz);
  }

  @Post('story')
  @HttpCode(200)
  story(@Auth() a: AuthContext, @Body(new ZodPipe(DayQuery)) b: { date: string; tz: string }) {
    return this.activity.story(a.userId, b.date, b.tz);
  }

  @Get('rules')
  rules(@Auth() a: AuthContext) {
    return this.activity.rules(a.userId);
  }

  @Put('rules')
  save(@Auth() a: AuthContext, @Body(new ZodPipe(ActivityRules)) b: ActivityRules) {
    return this.activity.saveRules(a.userId, b);
  }

  @Delete()
  remove(@Auth() a: AuthContext, @Query(new ZodPipe(Window)) q: { from: string; to: string }) {
    return this.activity.remove(a.userId, new Date(q.from), new Date(q.to));
  }
}

/** Owns activity_spans and activity_rules. */
@Module({
  providers: [ActivityService, Seal],
  controllers: [ActivityController],
  exports: [ActivityService],
})
export class ActivityModule {}
