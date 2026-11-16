import { type DynamicModule, Global, Module } from '@nestjs/common';
import { DevMailboxController } from './dev-mailbox.controller';
import { MailService } from './mail.service';

@Global()
@Module({})
export class MailModule {
  static register(production: boolean): DynamicModule {
    return {
      module: MailModule,
      providers: [MailService],
      exports: [MailService],
      controllers: production ? [] : [DevMailboxController],
    };
  }
}
