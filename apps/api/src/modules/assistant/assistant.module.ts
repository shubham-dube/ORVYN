import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** The Assistant (spec 0005). Owns assistant_threads and assistant_messages; changes go through sync. */
@Module({ imports: [SyncModule], providers: [AssistantService], controllers: [AssistantController] })
export class AssistantModule {}
