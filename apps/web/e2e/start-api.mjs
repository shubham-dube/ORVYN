// Fresh database + Redis db for every e2e run, then the real API (which migrates on start in development).
// Plain Node so CI needs no psql/redis-cli.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const postgres = require('postgres');
const Redis = require('ioredis');

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
await sql.unsafe(
  'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
);
await sql.end();
const r = new Redis(process.env.REDIS_URL);
await r.flushdb();
await r.quit();

const api = spawn(process.execPath, ['../api/dist/main.js'], { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => api.kill(sig));
api.on('exit', (code) => process.exit(code ?? 0));
