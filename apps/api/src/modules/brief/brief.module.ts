import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { SyncModule } from '../sync/sync.module';
import { BriefController } from './brief.controller';
import { BriefService } from './brief.service';

/** The Brief (spec 0009): owns brief_settings, briefs and brief_nudges. */
@Module({
  imports: [SyncModule, ConnectionsModule],
  providers: [BriefService],
  controllers: [BriefController],
})
export class BriefModule {}
