import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  CarryChatMessages,
  ChatReaction,
  EditChatMessage,
  NewConversation,
  RegisterChatDevice,
  SendChatMessage,
  SendMessage,
} from '@orvyn/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ChatService } from './chat.service';

const id = new ParseUUIDPipe();

/** Chat (spec 0011 part A, spec 0015 C). Every call is checked against membership (rule 5). */
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

  /** A message (spec 0015); the old sealed form (ADR-0014) still comes from apps that aren't updated yet. */
  @Post('conversations/:id/messages')
  send(@Auth() a: AuthContext, @Param('id', id) cid: string, @Body() raw: unknown) {
    const sealed = !!raw && typeof raw === 'object' && 'ciphertext' in raw;
    const r = (sealed ? SendMessage : SendChatMessage).safeParse(raw);
    if (!r.success)
      throw badRequest('invalid_request', r.error.issues[0]?.message ?? 'That message is not valid.');
    return sealed
      ? this.chat.sendSealed(a.userId, a.deviceId, cid, r.data as SendMessage)
      : this.chat.send(a.userId, a.deviceId, cid, r.data as SendChatMessage);
  }

  @Get('conversations/:id/search')
  search(@Auth() a: AuthContext, @Param('id', id) cid: string, @Query('q') q?: string) {
    return this.chat.search(a.userId, cid, (q ?? '').slice(0, 100));
  }

  @Post('conversations/:id/delivered')
  @HttpCode(200)
  delivered(@Auth() a: AuthContext, @Param('id', id) cid: string) {
    return this.chat.delivered(a.userId, cid);
  }

  @Put('conversations/:id/pin')
  pin(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(z.object({ messageId: z.string().uuid().nullable() }))) b: { messageId: string | null },
  ) {
    return this.chat.pinMessage(a.userId, cid, b.messageId);
  }

  @Put('conversations/:id/pinned')
  pinned(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(z.object({ pinned: z.boolean() }))) b: { pinned: boolean },
  ) {
    return this.chat.pinConversation(a.userId, cid, b.pinned);
  }

  @Post('conversations/:id/carry')
  @HttpCode(200)
  carry(
    @Auth() a: AuthContext,
    @Param('id', id) cid: string,
    @Body(new ZodPipe(CarryChatMessages)) b: CarryChatMessages,
  ) {
    return this.chat.carry(a.userId, cid, b);
  }

  @Patch('messages/:id')
  edit(
    @Auth() a: AuthContext,
    @Param('id', id) mid: string,
    @Body(new ZodPipe(EditChatMessage)) b: { text: string },
  ) {
    return this.chat.edit(a.userId, mid, b.text);
  }

  @Put('messages/:id/reaction')
  react(
    @Auth() a: AuthContext,
    @Param('id', id) mid: string,
    @Body(new ZodPipe(ChatReaction)) b: { emoji: string | null },
  ) {
    return this.chat.react(a.userId, mid, b.emoji);
  }

  @Post('messages/:id/hide')
  @HttpCode(200)
  hide(@Auth() a: AuthContext, @Param('id', id) mid: string) {
    return this.chat.hide(a.userId, mid);
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
      .header('x-file-type', f.mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=86400')
      .send(Buffer.from(f.bytes));
  }
}
