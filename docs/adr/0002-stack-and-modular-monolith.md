# ADR-0002: Stack and a modular monolith

- Status: Accepted · Date: 2026-11-16 · Related: founder's stack request

## Context
Founder's preferred stack: Next.js web, Flutter mobile, React Chrome extension, Nest.js backend, Postgres,
a Windows background companion. 5–50 users; cheapest hosting that is still production grade.

## Options
1. Microservices per feature — operational overhead with no benefit at this scale.
2. **One Nest.js app with strict module boundaries, plus a worker process from the same codebase.**
3. Backend-as-a-service (Supabase/Firebase) — fast start, but zero-knowledge vault, custom sync, AI pipelines
   and per-feature entitlements fight the platform.

## Decision
Option 2. TypeScript monorepo (pnpm + Turborepo): `apps/api` (Nest.js + Fastify adapter), `apps/web` (Next.js),
`apps/extension` (React, MV3), `apps/desktop` (**Tauri**: ~10 MB, native notifications/tray/hotkeys, reuses
web UI), `apps/mobile` (Flutter). PostgreSQL 16 + pgvector via **Drizzle ORM**; Valkey + BullMQ for queues;
Cloudflare R2 for files.

## Consequences
One deploy, one database, simple ops. Module rules (own tables, talk via services/events) keep it splittable.
Tauri instead of Electron keeps the Windows companion light enough to run all day.
