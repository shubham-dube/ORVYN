import { type DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { RedisModule } from './common/redis.module';
import { ENV, type Env } from './config/env';
import { DbModule } from './db/db.module';
import { AccessModule } from './modules/access/access.module';
import { logSerializers } from './common/log-serializers';
import { TodayModule } from './modules/today/today.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { AiModule } from './modules/ai/ai.module';
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
        ...(extra ?? []),
      ],
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
