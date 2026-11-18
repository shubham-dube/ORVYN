import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { ClickUpClient } from './clickup.client';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

/** Connected accounts beyond Google's (spec 0007 C2). Owns the connections table. */
@Module({
  imports: [CalendarModule],
  providers: [ConnectionsService, ClickUpClient],
  controllers: [ConnectionsController],
})
export class ConnectionsModule {}
