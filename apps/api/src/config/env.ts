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
  /** sign-in codes one IP may ask for per hour (shared offices / NAT may need more) */
  AUTH_IP_CODE_LIMIT: z.coerce.number().int().min(1).default(30),
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
  /** Gmail (optional per account, read-only: spec 0007 C2) */
  GOOGLE_GMAIL_API: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
  /** ClickUp (personal API tokens: spec 0007 C2) */
  CLICKUP_API: z.string().url().default('https://api.clickup.com/api/v2'),
  /** GitHub (personal tokens: spec 0008 B) */
  GITHUB_API: z.string().url().default('https://api.github.com'),
  /**
   * AI (ADR-0010, D13, D19): OpenRouter with ORVYN's own key, routes per task, one daily cap in USD.
   * AI_PROVIDER "fake" answers deterministically (tests, e2e, offline development); "off" refuses.
   */
  AI_PROVIDER: z.enum(['openrouter', 'fake', 'off']).optional(),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  AI_DAILY_BUDGET_USD: z.coerce.number().min(0).default(1),
  /** the day the cap resets in */
  AI_BUDGET_TZ: z.string().default('Asia/Kolkata'),
  /** JSON {task: model}; unknown tasks use "default" */
  AI_ROUTES: z.string().default(''),
  /** Files (ADR-0011): FILES_MASTER_KEY base64 32 bytes; storage "local" (FILES_DIR) or "s3" (R2). */
  FILES_MASTER_KEY: z.string().default(''),
  FILES_STORE: z.enum(['local', 's3']).default('local'),
  FILES_DIR: z.string().default('./.data/files'),
  S3_ENDPOINT: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  /**
   * WhatsApp reminders (D23): Meta's WhatsApp Business Cloud API. A message to someone who hasn't written to you in 24 h
   * must be an approved template with one body variable ({{1}} = the text). Without these, the WhatsApp way is off.
   */
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_ID: z.string().default(''),
  WHATSAPP_TEMPLATE: z.string().default('orvyn_reminder'),
  WHATSAPP_LANG: z.string().default('en'),
  WHATSAPP_API: z.string().url().default('https://graph.facebook.com/v21.0'),
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
    if (!env.FILES_MASTER_KEY) throw new Error('FILES_MASTER_KEY is required in production');
    if (env.GOOGLE_WEB_CLIENT_ID && !env.CALENDAR_TOKEN_KEY)
      throw new Error('CALENDAR_TOKEN_KEY is required in production when Google is configured');
  }
  return env;
}

export const ENV = Symbol('ENV');
