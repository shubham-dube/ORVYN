import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { type ContactChannels, NotifySettings, REMINDER_WAYS, RegisterPushRequest } from '@orvyn/contracts';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { badRequest } from '../../common/errors';
import { DB, type Db } from '../../db/db.module';
import { users } from '../auth/auth.schema';
import { deliveryFor } from './ways';
import { WhatsAppService } from './whatsapp.service';
import { ZodPipe } from '../../common/zod.pipe';
import { ENV, type Env } from '../../config/env';
import { Auth, type AuthContext, Public } from '../auth/auth.decorators';
import { NotifyService } from './notify.service';

@Controller('notifications')
export class NotifyController {
  constructor(
    private readonly notify: NotifyService,
    private readonly whatsapp: WhatsAppService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Where reminders can reach me besides the apps (D23): my account's email, and a confirmed WhatsApp number. */
  @Get('channels')
  async channels(@Auth() a: AuthContext): Promise<ContactChannels> {
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, a.userId));
    return { email: u?.email ?? '', whatsapp: await this.whatsapp.status(a.userId) };
  }

  @Put('whatsapp')
  async whatsappStart(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ number: z.string().min(6).max(30) }))) body: { number: string },
  ) {
    await this.whatsapp.start(a.userId, body.number);
    return this.whatsapp.status(a.userId);
  }

  @Post('whatsapp/verify')
  @HttpCode(200)
  async whatsappVerify(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ code: z.string().regex(/^\d{6}$/) }))) body: { code: string },
  ) {
    if (!(await this.whatsapp.confirm(a.userId, body.code)))
      throw badRequest('wrong_code', 'That code isn’t right, or it has expired.');
    return this.whatsapp.status(a.userId);
  }

  @Delete('whatsapp')
  async whatsappRemove(@Auth() a: AuthContext) {
    await this.whatsapp.remove(a.userId);
    return this.whatsapp.status(a.userId);
  }

  /** "Try it": sends a sample reminder through the ways picked, so a person knows what each will feel like. */
  @Post('try')
  @HttpCode(200)
  async tryWays(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ ways: z.array(z.enum(REMINDER_WAYS)).min(1).max(5) })))
    body: { ways: (typeof REMINDER_WAYS)[number][] },
  ) {
    await this.notify.send({
      userId: a.userId,
      module: 'today',
      kind: 'reminder.try',
      title: 'Sample reminder',
      body: 'This is how a reminder will reach you.',
      url: '/today',
      dedupeKey: 'try-reminder',
      ...deliveryFor(body.ways, false),
    });
    return { ok: true };
  }

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
  async act(
    @Auth() a: AuthContext,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body(new ZodPipe(z.object({ text: z.string().max(500).optional() }).default({})))
    body: { text?: string },
  ) {
    await this.notify.act(a.userId, id, actionId, a.deviceId, body?.text);
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

  /** "Send me a test notification", to every device or one; returns what each push service answered. */
  @Post('test')
  test(@Auth() a: AuthContext, @Body() body: { deviceId?: string } = {}) {
    const deviceId =
      typeof body?.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(body.deviceId)
        ? body.deviceId
        : undefined;
    return this.notify.test(a.userId, deviceId);
  }

  /** How notifications reach each of my devices right now (open, push, last result) and what the server can do. */
  @Get('delivery')
  delivery(@Auth() a: AuthContext) {
    return this.notify.delivery(a.userId);
  }

  @Public()
  @Get('vapid-public-key')
  vapid() {
    return { key: this.env.VAPID_PUBLIC_KEY || null };
  }
}
