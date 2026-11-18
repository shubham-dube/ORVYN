import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, Public, RequireEntitlement } from '../auth/auth.decorators';
import { CalendarService } from './calendar.service';
import { GoogleCalendarClient } from './google.client';

const MeetingRequest = z.object({
  accountId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(64).default('Asia/Kolkata'),
  attendees: z.array(z.string().email()).max(50).default([]),
  notes: z.string().max(4000).default(''),
  meet: z.boolean().default(true),
});

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly cal: CalendarService,
    private readonly google: GoogleCalendarClient,
  ) {}

  @Get('accounts')
  @RequireEntitlement('today')
  accounts(@Auth() a: AuthContext) {
    return this.cal.accounts(a.userId);
  }

  /** Begin connecting a Google account (another one, or the same again): the client opens the returned URL. */
  @Post('google/start')
  @HttpCode(200)
  @RequireEntitlement('today')
  async start(@Auth() a: AuthContext, @Query('hint') hint?: string, @Query('gmail') gmail?: string) {
    if (!this.google.configured)
      throw new AppError(
        HttpStatus.CONFLICT,
        'google_not_configured',
        'Google Calendar is not set up on this server yet.',
      );
    return { url: await this.cal.start(a.userId, hint, { gmail: gmail === '1' }) };
  }

  /** Google sends the browser back here; the one-time `state` ties it to the person who started. */
  @Public()
  @Get('google/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: FastifyReply,
  ) {
    return res.redirect(await this.cal.callback(code, state, error), 302);
  }

  /** Google push channel: no body, only headers; answer quickly. */
  @Public()
  @Post('google/webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-goog-channel-id') channelId: string | undefined,
    @Headers('x-goog-channel-token') token: string | undefined,
  ) {
    await this.cal.webhook(channelId, token);
    return { ok: true };
  }

  @Post('accounts/:id/sync')
  @HttpCode(200)
  @RequireEntitlement('today')
  async syncNow(@Auth() a: AuthContext, @Param('id') id: string) {
    const acc = (await this.cal.accounts(a.userId)).find((x) => x.id === id);
    if (!acc) throw notFound();
    await this.cal.poll(a.userId, id);
    return { ok: true };
  }

  /** A meeting with a Meet link on one of the person's Google accounts; Google emails the invitations. */
  @Post('meetings')
  @HttpCode(200)
  @RequireEntitlement('today')
  async meeting(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(MeetingRequest)) body: z.infer<typeof MeetingRequest>,
  ) {
    if (Date.parse(body.end) <= Date.parse(body.start))
      throw badRequest('bad_time', 'The meeting must end after it starts.');
    const r = await this.cal.scheduleMeeting(a.userId, body);
    if (!r) throw notFound();
    return r;
  }

  /** Unread mail on an account with Gmail added (read-only). */
  @Get('accounts/:id/inbox')
  @RequireEntitlement('today')
  async inbox(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.cal.inbox(a.userId, id);
    if (!r) throw notFound('gmail_not_added', 'Gmail isn’t added to this account.');
    return r;
  }

  @Delete('accounts/:id')
  @RequireEntitlement('today')
  async disconnect(@Auth() a: AuthContext, @Param('id') id: string) {
    if (!(await this.cal.disconnect(a.userId, id))) throw notFound();
    return { ok: true };
  }
}
