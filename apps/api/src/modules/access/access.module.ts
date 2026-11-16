import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AdminController } from './admin.controller';

@Global()
@Module({ providers: [AccessService], controllers: [AdminController], exports: [AccessService] })
export class AccessModule {}
