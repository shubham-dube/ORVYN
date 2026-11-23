import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { InboxModule } from '../inbox/inbox.module';
import { IpoModule } from '../ipo/ipo.module';
import { BriefOutside } from './brief.outside';
import { SyncModule } from '../sync/sync.module';
import { BriefController, HomeController } from './brief.controller';
import { BriefService } from './brief.service';

/** The Brief (spec 0009): owns brief_settings, briefs and brief_nudges. */
@Module({
  imports: [SyncModule, ConnectionsModule, IpoModule, InboxModule],
  providers: [BriefService, BriefOutside],
  controllers: [BriefController, HomeController],
})
export class BriefModule {}
