import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { GoogleCalendarClient } from './google.client';
import { TokenBox } from './token-box';

/** Connected calendars (spec 0002 M5). Owns calendar_accounts + calendar_sync_state; writes Today via sync. */
@Module({
  imports: [SyncModule],
  providers: [CalendarService, GoogleCalendarClient, TokenBox],
  controllers: [CalendarController],
  exports: [CalendarService],
})
export class CalendarModule {}
