import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadEnv } from './config/env';
import { runMigrations } from './db/migrate';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV !== 'production') await runMigrations(env.DATABASE_URL); // production migrates in the deploy step
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
