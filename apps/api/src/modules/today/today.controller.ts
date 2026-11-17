import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ParseRequest } from '@orvyn/contracts';
import { type Parsed, parseTask } from '@orvyn/today-parse';
import { and, eq, isNull } from 'drizzle-orm';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, type Db } from '../../db/db.module';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { todayProjects, todaySettings } from './today.schema';

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
}
