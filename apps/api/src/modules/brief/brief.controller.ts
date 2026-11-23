import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { BriefPlan, BriefSettings } from '@orvyn/contracts';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { BriefService } from './brief.service';

/** The Brief (spec 0009). Every call is the person's own; each section also checks its module. */
@Controller('brief')
@RequireEntitlement('brief')
export class BriefController {
  constructor(private readonly brief: BriefService) {}

  @Get('today')
  today(@Auth() a: AuthContext) {
    return this.brief.today(a.userId);
  }

  @Post('today/refresh')
  @HttpCode(200)
  refresh(@Auth() a: AuthContext) {
    return this.brief.today(a.userId, true);
  }

  @Get('history')
  history(@Auth() a: AuthContext, @Query('days') days?: string) {
    return this.brief.history(a.userId, Math.min(Math.max(Number(days) || 7, 1), 31));
  }

  /** Plan it: a focus task into its free slot (spec 0016 B1). */
  @Post('plan')
  @HttpCode(200)
  plan(@Auth() a: AuthContext, @Body(new ZodPipe(BriefPlan)) b: BriefPlan) {
    return this.brief.plan(a.userId, b);
  }

  /** Places for the weather (Open-Meteo geocoding). */
  @Get('places')
  places(@Query('q') q?: string) {
    return this.brief.places((q ?? '').slice(0, 80));
  }

  @Get('settings')
  settings(@Auth() a: AuthContext) {
    return this.brief.settings(a.userId);
  }

  @Put('settings')
  save(@Auth() a: AuthContext, @Body(new ZodPipe(BriefSettings)) body: BriefSettings) {
    return this.brief.saveSettings(a.userId, body);
  }
}

/** Home in one call (spec 0017 A): each part checks its own module. */
@Controller('home')
export class HomeController {
  constructor(private readonly brief: BriefService) {}

  @Get()
  home(@Auth() a: AuthContext) {
    return this.brief.home(a.userId);
  }
}
