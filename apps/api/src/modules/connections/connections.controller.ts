import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { badRequest, notFound } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ClickUpHub } from './clickup.hub';
import { ConnectionsService } from './connections.service';

const TASK_ID = /^[\w-]{1,40}$/;
const Conn = z.object({ connectionId: z.string().uuid() });
const TeamId = z
  .string()
  .regex(/^\d{1,20}$/)
  .optional();

/** The connections hub (spec 0007 C2). Part of Today, where what it brings in shows up. */
@Controller('connections')
@RequireEntitlement('today')
export class ConnectionsController {
  constructor(
    private readonly c: ConnectionsService,
    private readonly hub: ClickUpHub,
  ) {}

  @Get('providers')
  providers() {
    return this.c.providers();
  }

  @Get()
  list(@Auth() a: AuthContext) {
    return this.c.list(a.userId);
  }

  @Post('clickup')
  @HttpCode(200)
  async clickup(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ token: z.string().min(10).max(200) }))) body: { token: string },
  ) {
    const r = await this.c.connectClickUp(a.userId, body.token);
    if ('error' in r)
      throw badRequest('bad_token', 'ClickUp didn’t accept that token. Copy it again from ClickUp.');
    return r;
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.c.remove(a.userId, id))) throw notFound();
    return { ok: true };
  }

  /** Open tasks (default), or `?closed=1` for done/closed ones of the last 30 days (spec 0012 B2). */
  @Get('clickup/tasks')
  clickupTasks(@Auth() a: AuthContext, @Query('closed') closed?: string, @Query('fresh') fresh?: string) {
    if (closed === '1') return this.hub.closedTasks(a.userId);
    return this.c.clickupTasks(a.userId, { fresh: fresh === '1' });
  }

  @Get('clickup/statuses')
  clickupStatuses(@Auth() a: AuthContext) {
    return this.hub.statuses(a.userId);
  }

  /** "Show in Today": the statuses that mean "I'm on this"; null = back to the default rule. */
  @Put('clickup/settings')
  async clickupSettings(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        Conn.extend({ workingStatuses: z.array(z.string().trim().min(1).max(100)).max(100).nullable() }),
      ),
    )
    body: { connectionId: string; workingStatuses: string[] | null },
  ) {
    if (!(await this.hub.setWorking(a.userId, body.connectionId, body.workingStatuses))) throw notFound();
    return { ok: true };
  }

  @Get('clickup/tasks/:taskId')
  async clickupTask(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Query(new ZodPipe(Conn)) q: { connectionId: string },
  ) {
    if (!TASK_ID.test(taskId)) throw notFound();
    const r = await this.hub.detail(a.userId, q.connectionId, taskId);
    if (!r) throw notFound();
    return r;
  }

  /** Status and/or priority (1 urgent … 4 low, null none). */
  @Patch('clickup/tasks/:taskId')
  async clickupUpdate(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Body(
      new ZodPipe(
        Conn.extend({
          status: z.string().trim().min(1).max(100).optional(),
          priority: z.number().int().min(1).max(4).nullable().optional(),
        }),
      ),
    )
    body: { connectionId: string; status?: string; priority?: number | null },
  ) {
    if (!TASK_ID.test(taskId)) throw notFound();
    if (body.status === undefined && body.priority === undefined)
      throw badRequest('nothing', 'Nothing to change.');
    const { connectionId, ...set } = body;
    if (!(await this.hub.update(a.userId, connectionId, taskId, set))) throw notFound();
    return { ok: true };
  }

  @Post('clickup/tasks/:taskId/comments')
  async clickupComment(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Body(new ZodPipe(Conn.extend({ text: z.string().trim().min(1).max(10_000) })))
    body: { connectionId: string; text: string },
  ) {
    if (!TASK_ID.test(taskId)) throw notFound();
    const r = await this.hub.comment(a.userId, body.connectionId, taskId, body.text);
    if (!r) throw notFound();
    return r;
  }

  /** Time by duration or by range: the client sends the start and the minutes either way. */
  @Post('clickup/tasks/:taskId/time')
  async clickupTime(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Body(
      new ZodPipe(
        Conn.extend({
          teamId: TeamId,
          start: z.string().datetime({ offset: true }),
          durationMin: z
            .number()
            .int()
            .min(1)
            .max(24 * 60),
          note: z.string().trim().max(1000).optional(),
        }),
      ),
    )
    body: { connectionId: string; teamId?: string; start: string; durationMin: number; note?: string },
  ) {
    if (!TASK_ID.test(taskId)) throw notFound();
    if (Date.parse(body.start) > Date.now() + 60_000)
      throw badRequest('future', 'Time can’t start in the future.');
    const r = await this.hub.addTime(a.userId, body.connectionId, taskId, body);
    if (!r) throw notFound();
    return r;
  }

  @Delete('clickup/time/:entryId')
  async clickupDeleteTime(
    @Auth() a: AuthContext,
    @Param('entryId') entryId: string,
    @Query(new ZodPipe(Conn.extend({ teamId: TeamId }))) q: { connectionId: string; teamId?: string },
  ) {
    if (!/^[\w-]{1,40}$/.test(entryId)) throw notFound();
    if (!(await this.hub.deleteTime(a.userId, q.connectionId, q.teamId, entryId))) throw notFound();
    return { ok: true };
  }

  @Get('clickup/timer')
  async clickupTimer(@Auth() a: AuthContext) {
    return { timer: await this.hub.timer(a.userId) };
  }

  @Post('clickup/timer/start')
  @HttpCode(200)
  async clickupStart(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(Conn.extend({ taskId: z.string().regex(TASK_ID), teamId: TeamId })))
    body: { connectionId: string; taskId: string; teamId?: string },
  ) {
    const r = await this.hub.startTimer(a.userId, body.connectionId, body.taskId, body.teamId);
    if (!r) throw notFound();
    return { timer: r };
  }

  @Post('clickup/timer/stop')
  @HttpCode(200)
  async clickupStop(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(Conn.extend({ teamId: TeamId }))) body: { connectionId: string; teamId?: string },
  ) {
    const r = await this.hub.stopTimer(a.userId, body.connectionId, body.teamId);
    if (!r) throw notFound();
    return r;
  }

  @Post('clickup/tasks/:taskId/complete')
  @HttpCode(200)
  async complete(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Body(new ZodPipe(z.object({ connectionId: z.string().uuid() }))) body: { connectionId: string },
  ) {
    if (!/^[\w-]{1,40}$/.test(taskId)) throw notFound();
    if (!(await this.c.completeClickUp(a.userId, body.connectionId, taskId))) throw notFound();
    return { ok: true };
  }

  @Post('clickup/tasks')
  async createClickUp(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        z.object({
          connectionId: z.string().uuid(),
          listId: z.string().regex(/^[\w-]{1,40}$/),
          name: z.string().trim().min(1).max(300),
          dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullish(),
          dueAt: z.string().datetime({ offset: true }).nullish(),
        }),
      ),
    )
    body: {
      connectionId: string;
      listId: string;
      name: string;
      dueDate?: string | null;
      dueAt?: string | null;
    },
  ) {
    const r = await this.c.createClickUpTask(a.userId, body);
    if (!r) throw notFound();
    return r;
  }

  @Get('clickup/lists')
  clickupLists(@Auth() a: AuthContext) {
    return this.c.clickupLists(a.userId);
  }

  @Patch('clickup/tasks/:taskId/due')
  async due(
    @Auth() a: AuthContext,
    @Param('taskId') taskId: string,
    @Body(
      new ZodPipe(
        z.object({
          connectionId: z.string().uuid(),
          dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullish(),
          dueAt: z.string().datetime({ offset: true }).nullish(),
        }),
      ),
    )
    body: { connectionId: string; dueDate?: string | null; dueAt?: string | null },
  ) {
    if (!/^[\w-]{1,40}$/.test(taskId)) throw notFound();
    if (!(await this.c.setClickUpDue(a.userId, body.connectionId, taskId, body))) throw notFound();
    return { ok: true };
  }

  // ------------------------------------------------------------------ GitHub

  @Post('github')
  @HttpCode(200)
  async github(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ token: z.string().min(20).max(300) }))) body: { token: string },
  ) {
    const r = await this.c.connectGitHub(a.userId, body.token);
    if ('error' in r)
      throw badRequest(
        'bad_token',
        'GitHub didn’t accept that token. Check it hasn’t expired and copy it again.',
      );
    return r;
  }

  @Get('github/work')
  githubWork(@Auth() a: AuthContext) {
    return this.c.githubWork(a.userId);
  }

  /** My pull requests: open (with review and checks), merged and closed in the last 30 days (spec 0012 G). */
  @Get('github/prs')
  githubPrs(@Auth() a: AuthContext, @Query('fresh') fresh?: string) {
    return this.c.githubPrs(a.userId, { fresh: fresh === '1' });
  }

  @Put('github/settings')
  async githubSettings(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        Conn.extend({
          pings: z.object({ merged: z.boolean(), changes: z.boolean(), approved: z.boolean() }).partial(),
        }),
      ),
    )
    body: { connectionId: string; pings: { merged?: boolean; changes?: boolean; approved?: boolean } },
  ) {
    if (!(await this.c.setGitHubPings(a.userId, body.connectionId, body.pings))) throw notFound();
    return { ok: true };
  }

  @Post('github/issues/close')
  @HttpCode(200)
  async closeIssue(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        z.object({
          connectionId: z.string().uuid(),
          repo: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/),
          number: z.number().int().positive(),
        }),
      ),
    )
    body: { connectionId: string; repo: string; number: number },
  ) {
    if (!(await this.c.closeIssue(a.userId, body.connectionId, body.repo, body.number))) throw notFound();
    return { ok: true };
  }

  // ------------------------------------------------------------------ mail

  @Post('mail')
  @HttpCode(200)
  async connectMail(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        z.object({
          provider: z.string().max(20),
          email: z.string().email().max(200),
          password: z.string().min(4).max(200),
          host: z
            .string()
            .regex(/^[a-z0-9.-]{3,200}$/i)
            .optional(),
        }),
      ),
    )
    body: { provider: string; email: string; password: string; host?: string },
  ) {
    const r = await this.c.connectMail(a.userId, body);
    if ('error' in r) {
      if (r.error === 'bad_login')
        throw badRequest(
          'bad_login',
          'The mailbox didn’t accept that. Check IMAP is switched on and use an app password, not your normal one.',
        );
      throw badRequest(r.error ?? 'bad_host', 'Pick a provider, or give the IMAP host.');
    }
    return r;
  }

  @Get('mail')
  mail(@Auth() a: AuthContext) {
    return this.c.mail(a.userId);
  }

  @Post('mail/task')
  @HttpCode(200)
  mailTask(
    @Auth() a: AuthContext,
    @Body(
      new ZodPipe(
        z.object({
          subject: z.string().max(500),
          from: z.string().max(300),
          snippet: z.string().max(2000).optional(),
          url: z.string().url().max(1000).nullish(),
          smart: z.boolean().default(false),
        }),
      ),
    )
    body: { subject: string; from: string; snippet?: string; url?: string | null; smart: boolean },
  ) {
    return this.c.mailTask(a.userId, body, body.smart);
  }
}
