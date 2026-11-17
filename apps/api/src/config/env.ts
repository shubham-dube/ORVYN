import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Public URLs */
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Extra allowed CORS origins, e.g. chrome-extension://<id>, tauri://localhost */
  CORS_ORIGINS: list,
  /** The first sign-in with this email creates the owner account. */
  OWNER_EMAIL: z
    .string()
    .email()
    .transform((s) => s.toLowerCase()),
  /** ≥ 32 random bytes, base64/hex. Signs access tokens. */
  JWT_SECRET: z.string().min(32),
  /** ≥ 32 random bytes. Peppers stored hashes of codes and tokens. */
  TOKEN_PEPPER: z.string().min(32),
  /** Sign-in codes that can be sent to one email per 15 minutes. */
  AUTH_CODE_LIMIT: z.coerce.number().int().min(1).default(3),
  ACCESS_TOKEN_TTL_S: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),
  /** Cookie domain for the web refresh cookie, e.g. ".orvyn.dubey.app" in production; empty = host-only. */
  COOKIE_DOMAIN: z.string().default(''),
  /** WebAuthn relying party */
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('ORVYN'),
  WEBAUTHN_ORIGINS: list,
  /** Google sign-in: client ids allowed as ID token audience (web, android, desktop) + web secret for code flow. */
  GOOGLE_CLIENT_IDS: list,
  /** Chrome extension ids allowed to link to accounts (published id + your unpacked dev id). */
  EXTENSION_IDS: list,
  GOOGLE_WEB_CLIENT_ID: z.string().default(''),
  GOOGLE_WEB_CLIENT_SECRET: z.string().default(''),
  /**
   * Google Calendar (spec 0002 M5, D15): the same OAuth web client as sign-in, with the calendar scope.
   * CALENDAR_TOKEN_KEY (base64, 32 bytes) encrypts each account's tokens at rest (libsodium secretbox).
   * The URLs are configurable so tests run against a fake Google.
   */
  CALENDAR_TOKEN_KEY: z.string().default(''),
  GOOGLE_AUTH_URL: z.string().url().default('https://accounts.google.com/o/oauth2/v2/auth'),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GOOGLE_REVOKE_URL: z.string().url().default('https://oauth2.googleapis.com/revoke'),
  GOOGLE_USERINFO_URL: z.string().url().default('https://openidconnect.googleapis.com/v1/userinfo'),
  GOOGLE_CALENDAR_API: z.string().url().default('https://www.googleapis.com/calendar/v3'),
  /** Email (Resend). Without a key, mail goes to the dev outbox (never in production). */
  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('ORVYN <orvyn@dubey.app>'),
  /** Web Push (VAPID) */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@dubey.app'),
  /** FCM HTTP v1: service account JSON (base64) */
  FCM_SERVICE_ACCOUNT_B64: z.string().default(''),
  /** Which work this process does: the API, background workers, or both. */
  PROCESS_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Error reporting to the self-hosted GlitchTip (Sentry protocol). Empty = off. */
  SENTRY_DSN: z.union([z.literal(''), z.string().url()]).default(''),
  /** Deployed git revision, set by the deploy script. */
  RELEASE: z.string().default('dev'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required in production');
    if (env.API_URL.startsWith('http://')) throw new Error('API_URL must be https in production');
    if (env.GOOGLE_WEB_CLIENT_ID && !env.CALENDAR_TOKEN_KEY)
      throw new Error('CALENDAR_TOKEN_KEY is required in production when Google is configured');
  }
  return env;
}

export const ENV = Symbol('ENV');
