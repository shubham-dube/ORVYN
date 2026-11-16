import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './bootstrap';
import { loadEnv } from './config/env';
import { runMigrations } from './db/migrate';

/** Local runs read the repo's .env (production gets real environment variables from the container). */
function loadDotEnv(): void {
  for (const f of [resolve(__dirname, '../../../.env'), resolve(process.cwd(), '.env')]) {
    if (existsSync(f)) {
      process.loadEnvFile(f);
      return;
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') loadDotEnv();
  const env = loadEnv();
  if (env.NODE_ENV !== 'production') await runMigrations(env.DATABASE_URL); // production migrates in the deploy step
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
