import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type CalEvent, ParseRequest, PlanRequest, type TodaySettingsFields } from '@orvyn/contracts';
import { type Plan, planFromRecords } from '@orvyn/today-plan';
import { instantAt, looksUnread, type Parsed, parseTask, wallIn } from '@orvyn/today-parse';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { and, eq, gte, isNull, lt, lte, or } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { todayCalendars, todayEvents, todayProjects, todaySettings, todayTasks } from './today.schema';

@Controller('today')
@RequireEntitlement('today')
export class TodayController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ai: AiService,
  ) {}

  /**
   * The day at a glance, for small clients (the Chrome extension): open tasks due today or overdue, and today's
   * one-off events, in the person's zone (spec 0007 C4).
   */
  @Get('glance')
  async glance(@Auth() a: AuthContext) {
    const [settings] = await this.db
      .select({ timeZone: todaySettings.timeZone })
      .from(todaySettings)
      .where(eq(todaySettings.ownerId, a.userId));
    const tz = settings?.timeZone ?? 'Asia/Kolkata';
    const w = wallIn(new Date(), tz);
    const today = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
    const dayStart = instantAt(w.y, w.m, w.d, 0, 0, tz);
    const dayEnd = instantAt(w.y, w.m, w.d + 1, 0, 0, tz);
    const tasks = await this.db
      .select({
        id: todayTasks.id,
        title: todayTasks.title,
        dueDate: todayTasks.dueDate,
        dueAt: todayTasks.dueAt,
        priority: todayTasks.priority,
      })
      .from(todayTasks)
      .where(
        and(
          eq(todayTasks.ownerId, a.userId),
          isNull(todayTasks.deletedAt),
          isNull(todayTasks.completedAt),
          or(lte(todayTasks.dueDate, today), lt(todayTasks.dueAt, dayEnd)),
        ),
      )
      .limit(100);
    const events = await this.db
      .select({
        id: todayEvents.id,
        title: todayEvents.title,
        start: todayEvents.start,
        end: todayEvents.end,
        location: todayEvents.location,
      })
      .from(todayEvents)
      .where(
        and(
          eq(todayEvents.ownerId, a.userId),
          isNull(todayEvents.deletedAt),
          isNull(todayEvents.rrule),
          gte(todayEvents.start, dayStart),
          lt(todayEvents.start, dayEnd),
        ),
      )
      .limit(20);
    const at = (t: (typeof tasks)[number]) => t.dueAt?.getTime() ?? Date.parse(`${t.dueDate}T23:59:00Z`);
    return {
      today,
      tasks: tasks
        .map((t) => ({
          ...t,
          dueAt: t.dueAt?.toISOString() ?? null,
          overdue: t.dueAt ? t.dueAt < dayStart : (t.dueDate ?? today) < today,
        }))
        .sort(
          (x, y) =>
            Number(y.overdue) - Number(x.overdue) ||
            y.priority - x.priority ||
            at(x as never) - at(y as never),
        ),
      events: events
        .sort((x, y) => (x.start?.getTime() ?? 0) - (y.start?.getTime() ?? 0))
        .map((e) => ({ ...e, start: e.start?.toISOString() ?? null, end: e.end?.toISOString() ?? null })),
    };
  }

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
    const timeZone = body.timeZone ?? settings?.timeZone ?? 'Asia/Kolkata';
    const now = body.at ? new Date(body.at) : new Date();
    const parsed = parseTask(body.text, { now, timeZone, projects, literal: body.literal });
    if (!body.ai || !this.ai.available || !looksUnread(parsed)) return parsed;
    return this.aiRead(a.userId, body.text, parsed, now, timeZone);
  }

  /** The rules left date/time words unread: ask the AI for just those fields; on any trouble keep the rules' answer. */
  private async aiRead(
    ownerId: string,
    text: string,
    parsed: Parsed,
    now: Date,
    timeZone: string,
  ): Promise<Parsed & { by?: 'ai' }> {
    const wall = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(now);
    try {
      const r = await this.ai.complete({
        ownerId,
        task: 'today.parse',
        system: `You read one to-do written by a person in India. It is now ${wall} (${timeZone}).
Return {"title": the task without the date/time words, "date": "YYYY-MM-DD" or null, "time": "HH:MM" (24h) or null,
"durationMin": minutes or null, "rrule": an RFC 5545 RRULE body like "FREQ=WEEKLY;BYDAY=MO" or null}.
Hinglish is common: kal = tomorrow (or yesterday by context), parso = in two days, subah = morning, shaam = evening.`,
        data: [{ type: 'text', text }],
        schema: AiParse,
        maxTokens: 200,
      });
      let dueAt: string | null = null;
      if (r.date && r.time) {
        const [y, m, d] = r.date.split('-').map(Number) as [number, number, number];
        const [hh, mm] = r.time.split(':').map(Number) as [number, number];
        dueAt = instantAt(y, m, d, hh, mm, timeZone).toISOString();
      }
      return {
        ...parsed,
        title: r.title.trim() || parsed.title,
        dueAt: dueAt ?? parsed.dueAt,
        dueDate: dueAt ? null : (r.date ?? parsed.dueDate),
        durationMin: r.durationMin ?? parsed.durationMin,
        rrule: r.rrule ?? parsed.rrule,
        spans: [],
        by: 'ai',
      };
    } catch {
      return parsed; // paused, off or a bad answer: the rules' reading stands
    }
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

const AiParse = z.object({
  title: z.string().max(500),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  durationMin: z.number().int().min(5).max(1440).nullable().default(null),
  rrule: z.string().max(200).nullable().default(null),
});
