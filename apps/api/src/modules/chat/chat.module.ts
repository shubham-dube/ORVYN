import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Chat (spec 0011 part A). Owns chat_devices, chat_conversations, chat_members, chat_messages, chat_keys. */
@Module({
  imports: [FilesModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
