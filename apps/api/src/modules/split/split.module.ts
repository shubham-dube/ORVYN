import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SplitController, SplitLinkController } from './split.controller';
import { SplitService } from './split.service';

/** Split (spec 0011 part B): owns split_* tables; writes system lines into its group chat through ChatService. */
@Module({
  imports: [ChatModule],
  providers: [SplitService],
  controllers: [SplitController, SplitLinkController],
})
export class SplitModule {}
