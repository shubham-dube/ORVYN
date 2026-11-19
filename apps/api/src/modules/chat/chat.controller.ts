import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { NewConversation, RegisterChatDevice, SendMessage } from '@orvyn/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ChatService } from './chat.service';

const id = new ParseUUIDPipe();

/** Chat (spec 0011 part A). Every call is checked against membership; content is never readable here. */
@Controller('chat')
@RequireEntitlement('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Put('devices')
  device(@Auth() a: AuthContext, @Body(new ZodPipe(RegisterChatDevice)) b: RegisterChatDevice) {
    return this.chat.registerDevice(a.userId, a.deviceId, b);
  }

  @Get('keys')
  keys(@Auth() a: AuthContext, @Query('userIds') userIds?: string) {
    const ids = (userIds ?? '')
      .split(',')
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, 60);
    return this.chat.keys(a.userId, ids);
  }

  @Get('people')
  people(@Auth() a: AuthContext) {
    return this.chat.people(a.userId);
  }

  @Get('conversations')
  list(@Auth() a: AuthContext) {
    return this.chat.list(a.userId);
  }

  @Post('conversations')
  create(@Auth() a: AuthContext, @Body(new ZodPipe(NewConversation)) b: NewConversation) {
    return this.chat.create(a.userId, b);
  }

  @Get('conversations/:id')
  view(@Auth() a: AuthContext, @Param('id', id) cid: string) {
    return this.chat.view(a.userId, cid);
  }

  @Post('conversations/:id/members')
  @HttpCode(200)
  add(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(z.object({ userIds: z.array(z.string().uuid()).min(1).max(49) })))
    b: { userIds: string[] },
  ) {
    return this.chat.addMembers(a.userId, cid, b.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  removeMember(@Auth() a: AuthContext, @Param('id', id) cid: string, @Param('userId', id) uid: string) {
    return this.chat.removeMember(a.userId, cid, uid);
  }

  @Put('conversations/:id/title')
  rename(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(z.object({ title: z.string().trim().min(1).max(80) }))) b: { title: string },
  ) {
    return this.chat.rename(a.userId, cid, b.title);
  }

  @Put('conversations/:id/mute')
  mute(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(z.object({ muted: z.boolean() }))) b: { muted: boolean },
  ) {
    return this.chat.mute(a.userId, cid, b.muted);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@Auth() a: AuthContext, @Param('id', id) cid: string) {
    return this.chat.read(a.userId, cid);
  }

  @Post('conversations/:id/typing')
  @HttpCode(200)
  typing(@Auth() a: AuthContext, @Param('id', id) cid: string) {
    return this.chat.typing(a.userId, cid);
  }

  @Get('conversations/:id/messages')
  messages(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.messages(a.userId, a.deviceId, cid, {
      before: before && /^[0-9a-f-]{36}$/i.test(before) ? before : undefined,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
    });
  }

  @Post('conversations/:id/messages')
  send(@Auth() a: AuthContext, @Param('id', id) cid: string, @Body(new ZodPipe(SendMessage)) b: SendMessage) {
    return this.chat.send(a.userId, a.deviceId, cid, b);
  }

  @Delete('messages/:id')
  remove(@Auth() a: AuthContext, @Param('id', id) mid: string) {
    return this.chat.remove(a.userId, mid);
  }

  @Get('conversations/:id/files/:fileId')
  async file(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Param('fileId', id) fid: string,
    @Res() res: FastifyReply,
  ) {
    const f = await this.chat.file(a.userId, cid, fid);
    return res
      .header('content-type', 'application/octet-stream')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=86400')
      .send(Buffer.from(f.bytes));
  }
}
