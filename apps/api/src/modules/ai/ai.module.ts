import { Global, Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/** The only module that talks to a model (ADR-0010). Global so feature modules can ask it. */
@Global()
@Module({ providers: [AiService], controllers: [AiController], exports: [AiService] })
export class AiModule {}
