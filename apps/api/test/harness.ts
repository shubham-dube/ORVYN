import 'reflect-metadata';
import { type DynamicModule } from '@nestjs/common';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { type DeviceInfo, type SessionResponse } from '@orvyn/contracts';
import Redis from 'ioredis';
import postgres from 'postgres';
import { AppModule } from '../src/app.module';
import { configureApp, fastifyAdapter } from '../src/bootstrap';
import { type Env, loadEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';
import { GoogleVerifier } from '../src/modules/auth/google.service';

export const OWNER = 'owner@example.test';

export function testEnv(over: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://orvyn:orvyn@localhost:5432/orvyn_test',
    REDIS_URL: (process.env.REDIS_URL ?? 'redis://localhost:6379') + '/15',
    OWNER_EMAIL: OWNER,
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789',
    TOKEN_PEPPER: 'test-pepper-0123456789abcdef0123456789abcd',
    WEB_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:4000',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGINS: 'http://localhost:3000',
    GOOGLE_CLIENT_IDS: 'test-client',
    LOG_LEVEL: 'error',
    AUTH_CODE_LIMIT: '20',
    ...over,
  });
}

/** Fresh schema + empty Redis db for every test file. */
export async function resetStores(env: Env): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  await sql.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  );
  await sql.end();
  await runMigrations(env.DATABASE_URL);
  const r = new Redis(env.REDIS_URL);
  await r.flushdb();
  await r.quit();
}

export class FakeGoogle {
  configured = true;
  async verify(idToken: string) {
    const [email, name] = idToken.split('|');
    if (!email) throw new Error('bad token');
    return { email, name: name ?? '', picture: null };
  }
}

export interface Harness {
  app: NestFastifyApplication;
  url: string;
  env: Env;
  close: () => Promise<void>;
}

export async function startApp(
  extra: DynamicModule['imports'] = [],
  over: Record<string, string> = {},
): Promise<Harness> {
  const env = testEnv(over);
  await resetStores(env);
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(env, extra)] })
    .overrideProvider(GoogleVerifier)
    .useValue(new FakeGoogle())
    .compile();
  const app = mod.createNestApplication<NestFastifyApplication>(fastifyAdapter(), { logger: false });
  await configureApp(app, env);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return { app, url: url.replace('[::1]', '127.0.0.1'), env, close: () => app.close() };
}

export interface Res<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export async function call<T = any>(
  h: Harness,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; cookie?: string } = {},
): Promise<Res<T>> {
  const res = await fetch(h.url + path, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

export const device = (platform: DeviceInfo['platform'] = 'android', name = 'Test phone'): DeviceInfo => ({
  name,
  platform,
  appVersion: '0.1.0',
});

/** Full email-code sign-in through the dev mailbox. */
export async function signIn(
  h: Harness,
  email: string,
  opts: { invite?: string; platform?: DeviceInfo['platform'] } = {},
) {
  const start = await call(h, 'POST', '/auth/email/start', { body: { email, invite: opts.invite } });
  if (start.status !== 200) throw new Error(`start failed ${start.status} ${JSON.stringify(start.body)}`);
  const mail = await call<{ subject: string }>(h, 'GET', `/dev/mailbox?email=${encodeURIComponent(email)}`);
  if (mail.status !== 200) throw new Error(`no code mailed to ${email}`);
  const code = /\d{6}/.exec(mail.body.subject)![0];
  return call<SessionResponse>(h, 'POST', '/auth/email/verify', {
    body: { email, code, device: device(opts.platform ?? 'android'), invite: opts.invite },
  });
}
