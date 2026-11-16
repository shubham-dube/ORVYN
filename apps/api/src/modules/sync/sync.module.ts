import { Global, Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncRegistry } from './sync.registry';
import { SyncService } from './sync.service';

@Global()
@Module({ providers: [SyncRegistry, SyncService], controllers: [SyncController], exports: [SyncRegistry] })
export class SyncModule {}
