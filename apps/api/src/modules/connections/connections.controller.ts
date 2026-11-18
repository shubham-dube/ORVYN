import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
}
