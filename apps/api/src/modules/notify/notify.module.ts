import { Global, Module } from '@nestjs/common';
import { NotifyController } from './notify.controller';
import { NotifyService } from './notify.service';
import { LivePushSender, PUSH_SENDER } from './push-sender';

@Global()
@Module({
  providers: [NotifyService, { provide: PUSH_SENDER, useClass: LivePushSender }],
  controllers: [NotifyController],
  exports: [NotifyService],
})
export class NotifyModule {}
