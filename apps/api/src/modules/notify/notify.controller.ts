import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { NotifySettings, RegisterPushRequest } from '@orvyn/contracts';
import { ZodPipe } from '../../common/zod.pipe';
import { ENV, type Env } from '../../config/env';
import { Auth, type AuthContext, Public } from '../auth/auth.decorators';
import { NotifyService } from './notify.service';

@Controller('notifications')
export class NotifyController {
  constructor(
    private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  list(@Auth() a: AuthContext, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.notify.list(a.userId, before, Number(limit) || 50);
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.notify.markRead(a.userId, id, a.deviceId);
    return { ok: true };
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.notify.dismiss(a.userId, id, a.deviceId);
    return { ok: true };
  }

  @Post(':id/actions/:actionId')
  @HttpCode(200)
  async act(@Auth() a: AuthContext, @Param('id') id: string, @Param('actionId') actionId: string) {
    await this.notify.act(a.userId, id, actionId, a.deviceId);
    return { ok: true };
  }

  @Post('dismiss-all')
  @HttpCode(200)
  async dismissAll(@Auth() a: AuthContext) {
    return { dismissed: await this.notify.dismissAll(a.userId, a.deviceId) };
  }

  @Get('settings')
  settings(@Auth() a: AuthContext) {
    return this.notify.settings(a.userId);
  }

  @Put('settings')
  saveSettings(@Auth() a: AuthContext, @Body(new ZodPipe(NotifySettings)) body: NotifySettings) {
    return this.notify.saveSettings(a.userId, body);
  }

  @Post('targets')
  register(@Auth() a: AuthContext, @Body(new ZodPipe(RegisterPushRequest)) body: RegisterPushRequest) {
    return this.notify.registerTarget(a.userId, a.deviceId, body);
  }

  @Delete('targets/:id')
  async unregister(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.notify.removeTarget(a.userId, id);
    return { ok: true };
  }

  /** "Send me a test notification" (settings screen). */
  @Post('test')
  test(@Auth() a: AuthContext) {
    return this.notify.send({
      userId: a.userId,
      module: 'core',
      kind: 'test',
      title: 'Hello from ORVYN',
      body: 'Notifications are working on this device.',
      priority: 'normal',
      actions: [{ id: 'ok', label: 'Nice' }],
    });
  }

  @Public()
  @Get('vapid-public-key')
  vapid() {
    return { key: this.env.VAPID_PUBLIC_KEY || null };
  }
}
