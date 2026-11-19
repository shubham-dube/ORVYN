import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { badRequest, notFound } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ConnectionsService } from './connections.service';

/** The connections hub (spec 0007 C2). Part of Today, where what it brings in shows up. */
@Controller('connections')
@RequireEntitlement('today')
export class ConnectionsController {
  constructor(private readonly c: ConnectionsService) {}

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

  @Get('clickup/tasks')
  clickupTasks(@Auth() a: AuthContext) {
    return this.c.clickupTasks(a.userId);
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
