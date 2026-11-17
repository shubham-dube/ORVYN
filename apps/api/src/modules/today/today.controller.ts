import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type CalEvent, ParseRequest, PlanRequest, type TodaySettingsFields } from '@orvyn/contracts';
import { type Plan, planFromRecords } from '@orvyn/today-plan';
import { type Parsed, parseTask } from '@orvyn/today-parse';
import { and, eq, isNull } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { todayCalendars, todayEvents, todayProjects, todaySettings, todayTasks } from './today.schema';

@Controller('today')
@RequireEntitlement('today')
export class TodayController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** For clients without the parser package (Android): same rules, the person's zone and projects. */
  @Post('parse')
  @HttpCode(200)
  async parse(@Auth() a: AuthContext, @Body(new ZodPipe(ParseRequest)) body: ParseRequest): Promise<Parsed> {
    const [settings] = await this.db
      .select({ timeZone: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, a.userId));
    const projects = await this.db
      .select({ id: todayProjects.id, name: todayProjects.name })
      .from(todayProjects)
      .where(and(eq(todayProjects.ownerId, a.userId), isNull(todayProjects.deletedAt)));
    return parseTask(body.text, {
      now: new Date(),
      timeZone: body.timeZone ?? settings?.timeZone ?? 'Asia/Kolkata',
      projects,
      literal: body.literal,
    });
  }

  /**
   * "Plan my day" preview (AC6) for clients without the planner package (Android). Nothing changes until the
   * person accepts, which is an ordinary task edit from their device. Needs their working hours (D16): nothing
   * is assumed.
   */
  @Post('plan')
  @HttpCode(200)
  async plan(@Auth() a: AuthContext, @Body(new ZodPipe(PlanRequest)) body: PlanRequest): Promise<Plan> {
    const [s] = await this.db.select().from(todaySettings).where(eq(todaySettings.ownerId, a.userId));
    if (!s)
      throw new AppError(
        HttpStatus.CONFLICT,
        'no_working_hours',
        'Set your working hours first, then I can plan.',
      );
    const owner = (t: { ownerId: PgColumn; deletedAt: PgColumn }) =>
      and(eq(t.ownerId, a.userId), isNull(t.deletedAt));
    const [tasks, events, hidden] = await Promise.all([
      this.db
        .select()
        .from(todayTasks)
        .where(and(owner(todayTasks), isNull(todayTasks.completedAt))),
      // repeating events can start long before the day: the expander picks what touches it
      this.db.select().from(todayEvents).where(owner(todayEvents)),
      this.db
        .select({ id: todayCalendars.id })
        .from(todayCalendars)
        .where(and(owner(todayCalendars), eq(todayCalendars.visible, false))),
    ]);
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return planFromRecords({
      date: body.date,
      now: new Date(),
      settings: s as unknown as TodaySettingsFields,
      events: events.map((e) => ({ ...e, start: iso(e.start), end: iso(e.end) }) as CalEvent),
      hiddenCalendars: new Set(hidden.map((h) => h.id)),
      tasks: tasks.map((t) => ({
        ...t,
        dueAt: iso(t.dueAt),
        scheduledStart: iso(t.scheduledStart),
        completedAt: null,
      })),
    });
  }
}
