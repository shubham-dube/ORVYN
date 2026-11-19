import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AskRequest } from '@orvyn/contracts';
import type { z } from 'zod';
import { notFound } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { AssistantService } from './assistant.service';

@Controller('assistant')
@RequireEntitlement('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('threads')
  threads(@Auth() a: AuthContext) {
    return this.assistant.threads(a.userId);
  }

  @Get('threads/:id')
  async messages(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.assistant.messages(a.userId, id);
    if (!r) throw notFound();
    return r;
  }

  @Delete('threads/:id')
  async remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.assistant.remove(a.userId, id))) throw notFound();
    return { ok: true };
  }

  @Post('ask')
  @HttpCode(200)
  async ask(@Auth() a: AuthContext, @Body(new ZodPipe(AskRequest)) body: z.infer<typeof AskRequest>) {
    const r = await this.assistant.ask(a, body.text, body.threadId);
    if (!r) throw notFound();
    return r;
  }

  @Post('messages/:id/proposals/:index/:decision')
  @HttpCode(200)
  async decide(
    @Auth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Param('decision') decision: string,
  ) {
    if (decision !== 'confirm' && decision !== 'dismiss') throw notFound();
    const r = await this.assistant.decide(a, id, index, decision === 'confirm');
    if (!r) throw notFound();
    return r;
  }
}
