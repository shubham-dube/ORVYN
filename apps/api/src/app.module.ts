import { type DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { RedisModule } from './common/redis.module';
import { ENV, type Env } from './config/env';
import { DbModule } from './db/db.module';
import { AccessModule } from './modules/access/access.module';
import { logSerializers } from './common/log-serializers';
import { TodayModule } from './modules/today/today.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { BriefModule } from './modules/brief/brief.module';
import { IpoModule } from './modules/ipo/ipo.module';
import { ChatModule } from './modules/chat/chat.module';
import { SplitModule } from './modules/split/split.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { AiModule } from './modules/ai/ai.module';
import { MoneyModule } from './modules/money/money.module';
import { DropModule } from './modules/drop/drop.module';
import { LibraryModule } from './modules/library/library.module';
import { VaultModule } from './modules/vault/vault.module';
import { ActivityModule } from './modules/activity/activity.module';
import { FillModule } from './modules/fill/fill.module';
import { FilesModule } from './modules/files/files.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { MailModule } from './modules/mail/mail.module';
import { NotifyModule } from './modules/notify/notify.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({})
export class AppModule {
  static forRoot(env: Env, extra: DynamicModule['imports'] = []): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // never log secrets: request lines carry only method, masked path and status (log-serializers.ts)
            serializers: logSerializers,
            redact: ['req.headers', 'res.headers'],
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
            autoLogging: env.NODE_ENV !== 'test',
          },
        }),
        EventEmitterModule.forRoot(),
        DbModule,
        RedisModule,
        AuditModule,
        MailModule.register(env.NODE_ENV === 'production'),
        AccessModule,
        AuthModule,
        RealtimeModule,
        SyncModule,
        AiModule,
        FilesModule,
        NotifyModule,
        TodayModule,
        CalendarModule,
        AssistantModule,
        BriefModule,
        IpoModule,
        ChatModule,
        SplitModule,
        ConnectionsModule,
        InboxModule,
        MoneyModule,
        DropModule,
        LibraryModule,
        VaultModule,
        ActivityModule,
        FillModule,
        ...(extra ?? []),
      ],
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
