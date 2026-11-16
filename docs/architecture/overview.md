# Architecture overview

```
 Android (Flutter) ─┐                      ┌─ PostgreSQL 16 (+ pgvector)   ← all structured data, sync log,
 iPhone / any browser (Next.js PWA) ─┤      │                                    embeddings for search/RAG
 Chrome extension ──┤  HTTPS + WebSocket   ├─ Valkey (Redis-compatible)   ← queues (BullMQ), realtime fan-out,
 Windows companion ─┘        │              │                                    rate limits, short caches
                             ▼              ├─ Object storage (Cloudflare R2) ← files, encrypted per object
                    ┌─────────────────┐     │
                    │  api (Nest.js)  │─────┤
                    │ modular monolith│     └─ Push: FCM (Android), Web Push/VAPID (web + iPhone PWA),
                    └─────────────────┘         WebSocket (Windows companion, open apps), email (Resend)
                       │ workers (same codebase, separate process): AI jobs, OCR, imports, reminders,
                       │ notification fan-out, IPO data refresh, backups
                       ▼
                 AI providers (OpenRouter: Fable / Opus / Haiku…) · local embeddings on the server
                 JobOS API (separate system)
```

## Why a modular monolith (ADR-0002)

5–50 people do not need microservices; they need one deployable thing that is easy to run on a small server.
Nest.js modules give hard boundaries anyway: each module owns its tables, controllers, events, jobs,
notifications and permissions. If one module ever needs to be split out, its boundary is already there.

## Modules

| Module      | Owns                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| `auth`      | accounts, passkeys, OAuth, sessions, devices                                         |
| `access`    | roles, per-person feature switches (entitlements), admin                             |
| `sync`      | change log, cursors, mutation intake, conflict rules (used by every synced module)   |
| `notify`    | one notification pipeline for all modules: channels, quiet hours, dismiss-everywhere |
| `files`     | uploads, object storage, encryption, thumbnails, OCR hand-off                        |
| `ai`        | model routing, budgets, prompt templates, tracing, embeddings, retrieval             |
| `today`     | tasks, events, recurrence, reminders, calendar sync                                  |
| `drop`      | universal inbox: understand → propose → confirm → hand to the owning module          |
| `money`     | accounts, transactions, categories, budgets, rules, imports                          |
| `vault`     | encrypted blobs + metadata needed to sync them (never plaintext)                     |
| `library`   | documents, collections, tags, extracted facts                                        |
| `assistant` | conversations, tools exposed by other modules                                        |
| `chat`      | conversations, encrypted message relay, keys directory                               |
| `ipo`       | issues, subscription data, documents, analyses, alerts                               |
| `jobs`      | JobOS connector                                                                      |

Modules call each other only through exported services or domain events (`event-emitter` in-process, BullMQ
for anything slow). A module never reads another module's tables.

## Clients

- **Web (Next.js, App Router)** — full app, installable PWA (offline, push; this is the iPhone app for now),
  admin console. Local store: IndexedDB.
- **Mobile (Flutter)** — Android first, iOS-ready. Local store: SQLite (Drift). Home-screen widgets, share
  sheet, notification actions, Android SMS/notification reading for Money (on-device parsing).
- **Chrome extension (React, Manifest V3)** — quick capture, save page/selection to Library, later vault
  autofill (vault decrypts only inside the extension).
- **Windows companion (Tauri — small, native, web UI)** — tray icon, native notifications with actions, global
  hotkey for quick capture, start on login. Later can host the JobOS runner.

## Shared packages

- `packages/design-tokens` — one JSON source → CSS variables, Tailwind theme, Dart `ThemeExtension`.
- `packages/contracts` — zod schemas for every API payload → TypeScript types and OpenAPI → Dart client.
- `packages/crypto` — vault and chat crypto wrappers over audited libraries, with test vectors shared with
  the Dart implementation so both sides provably agree.
