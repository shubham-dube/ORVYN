import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PushRequest } from '@orvyn/contracts';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext } from '../auth/auth.decorators';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  @HttpCode(200)
  push(@Auth() a: AuthContext, @Body(new ZodPipe(PushRequest)) body: PushRequest) {
    return this.sync.push(a, body.mutations);
  }

  @Get('pull')
  pull(@Auth() a: AuthContext, @Query('cursor') cursor?: string) {
    return this.sync.pull(a, cursor);
  }
}
