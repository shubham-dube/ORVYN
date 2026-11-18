import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the real API (dev mailbox on) + the production web build, against a throwaway database.
 * Ports differ from `pnpm dev` so both can run side by side.
 */
const API = 'http://localhost:4100';
const WEB = 'http://localhost:3100';
const secret = () => Array.from({ length: 48 }, () => Math.random().toString(36)[2]).join('');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: WEB, trace: 'off', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: '4100',
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://orvyn:orvyn@localhost:5432/orvyn_e2e',
        REDIS_URL: (process.env.REDIS_URL ?? 'redis://localhost:6379') + '/14',
        OWNER_EMAIL: 'owner@example.test',
        JWT_SECRET: secret(),
        TOKEN_PEPPER: secret(),
        AUTH_CODE_LIMIT: '50',
        API_URL: API,
        WEB_URL: WEB,
        CORS_ORIGINS: WEB,
        WEBAUTHN_RP_ID: 'localhost',
        WEBAUTHN_ORIGINS: WEB,
        LOG_LEVEL: 'warn',
        // the deterministic model (no key, no network): Drop and the parser fallback are exercised end to end
        AI_PROVIDER: 'fake',
        EXTENSION_IDS: 'hapijaoahockgcidibcnbghpajpnnanh',
      },
    },
    {
      command: 'pnpm exec next start -p 3100',
      url: WEB + '/sign-in',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
