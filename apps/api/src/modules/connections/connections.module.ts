import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { ClickUpClient } from './clickup.client';
import { ClickUpHub } from './clickup.hub';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { ConnectionsWatcher } from './connections.watcher';
import { GitHubClient } from './github.client';
import { ImapMailbox, Mailbox } from './mailbox';

/** Connected accounts beyond Google's (spec 0007 C2). Owns the connections table. */
@Module({
  imports: [CalendarModule],
  providers: [
    ConnectionsService,
    ConnectionsWatcher,
    ClickUpClient,
    ClickUpHub,
    GitHubClient,
    { provide: Mailbox, useClass: ImapMailbox },
  ],
  controllers: [ConnectionsController],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
