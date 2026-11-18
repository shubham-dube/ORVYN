import { Global, Module } from '@nestjs/common';
import { NotifyController } from './notify.controller';
import { WhatsAppService } from './whatsapp.service';
import { NotifyService } from './notify.service';
import { LivePushSender, PUSH_SENDER } from './push-sender';

@Global()
@Module({
  providers: [NotifyService, WhatsAppService, { provide: PUSH_SENDER, useClass: LivePushSender }],
  controllers: [NotifyController],
  exports: [NotifyService, WhatsAppService],
})
export class NotifyModule {}
