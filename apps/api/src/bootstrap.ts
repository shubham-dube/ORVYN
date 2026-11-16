import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { type DynamicModule, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { type Env } from './config/env';

export const fastifyAdapter = () => new FastifyAdapter({ trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

/** Builds the app (used by main.ts). Tests build through Test.createTestingModule + configureApp. */
export async function createApp(env: Env, extra: DynamicModule['imports'] = []): Promise<INestApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, extra),
    fastifyAdapter(),
    {
      bufferLogs: true,
    },
  );
  await configureApp(app, env);
  return app;
}

export async function configureApp(app: NestFastifyApplication, env: Env): Promise<void> {
  app.useLogger(app.get(Logger));
  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON only; the web app sets its own CSP
  await app.register(cookie);
  const origins = [env.WEB_URL, ...env.CORS_ORIGINS];
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
}
