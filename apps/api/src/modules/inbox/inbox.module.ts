import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InboxActBody, InboxSenderBody, InboxSettings } from '@orvyn/contracts';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, type AuthContext, RequireEntitlement } from '../auth/auth.decorators';
import { ConnectionsModule } from '../connections/connections.module';
import { SyncModule } from '../sync/sync.module';
import { InboxService } from './inbox.service';

/** The smart inbox (spec 0017 B). Mail lives with Today's tools (the `today` entitlement, like spec 0008). */
@Controller('inbox')
@RequireEntitlement('today')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@Auth() a: AuthContext, @Query('fresh') fresh?: string) {
    return this.inbox.get(a.userId, fresh === '1');
  }

  /** Small, for the Mail badge in the sidebar and the launcher. */
  @Get('counts')
  async counts(@Auth() a: AuthContext) {
    const v = await this.inbox.get(a.userId, false);
    return {
      important: v.important.length,
      unread: v.boxes.reduce((s, b) => s + b.unread, 0),
      boxes: v.boxes.map((b) => ({ account: b.account, unread: b.unread, important: b.important ?? 0 })),
    };
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Auth() a: AuthContext) {
    return this.inbox.get(a.userId, true);
  }

  @Post('items/:id/act')
  @HttpCode(200)
  act(
    @Auth() a: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(InboxActBody)) b: { action: 'done' | 'pin' | 'unpin' | 'remind' },
  ) {
    return this.inbox.act(a.userId, id, b.action);
  }

  @Put('senders')
  sender(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(InboxSenderBody)) b: { email: string; rule: 'vip' | 'mute' | null },
  ) {
    return this.inbox.setSender(a.userId, b.email, b.rule);
  }

  @Get('settings')
  settings(@Auth() a: AuthContext) {
    return this.inbox.settings(a.userId);
  }

  @Put('settings')
  save(@Auth() a: AuthContext, @Body(new ZodPipe(InboxSettings)) b: InboxSettings) {
    return this.inbox.saveSettings(a.userId, b);
  }
}

/** Owns inbox_items, inbox_senders and inbox_settings. */
@Module({
  imports: [ConnectionsModule, SyncModule],
  providers: [InboxService],
  controllers: [InboxController],
  exports: [InboxService],
})
export class InboxModule {}
