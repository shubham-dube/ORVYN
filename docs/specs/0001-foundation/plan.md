# Plan 0001: Foundation

## Workspace
pnpm workspaces + Turborepo. Node 22, TypeScript 5 strict. ESLint (typescript-eslint) + Prettier. Vitest for
TS tests. GitHub Actions: lint, typecheck, unit + integration tests (Postgres 16 + Valkey service containers),
web build, extension build, Tauri build matrix (Linux check + Windows installer artifact), Flutter analyze/test +
Android APK, gitleaks.

## packages/
| Package | Contents |
|---|---|
| `design-tokens` | `tokens.json` (phases × mode palettes, glass levels, radii, spacing, type, springs, durations, module accents, haptics) → generator → `dist/tokens.css` (CSS variables, `[data-phase]` + `[data-mode]`), `dist/tailwind.css` (Tailwind v4 `@theme`), `dist/tokens.ts`, `dist/orvyn_tokens.dart` (copied into the Flutter app). Contrast test: every text/glass pair ≥ 4.5:1. |
| `contracts` | zod schemas + types for every API payload (auth, devices, access, sync, notify, ws messages); HLC implementation; entitlement keys. |
| `sync-client` | TS sync client (IndexedDB via Dexie): outbox, pull loop, HLC merge, ws "changed" handling. Used by web and extension. |

## apps/api (Nest.js 11, Fastify adapter)
- Config: `@nestjs/config` + zod-validated env. Logging: pino (`nestjs-pino`), request ids, no PII/secrets in logs.
- DB: Drizzle ORM + `postgres` driver; drizzle-kit migrations committed; one schema file per module.
- Queue: BullMQ on Valkey (notification delivery, scheduled jobs).
- Realtime: `@nestjs/platform-ws` gateway; clients authenticate with the access token; topics per user.
- Modules (foundation): `health`, `auth`, `devices` (inside auth), `access`, `audit`, `sync`, `notify`, `mail`.

### auth
- **Email code**: 6 digits, hashed (SHA-256 + pepper), 10 min, 5 attempts, 3 sends/15 min per email+IP.
- **Google**: web → OAuth code flow (PKCE) at the API; mobile/desktop → Google ID token verified with
  `google-auth-library`.
- **Passkeys**: `@simplewebauthn/server`; registration after first sign-in; usernameless sign-in.
- **Sessions**: access JWT (HS256, 15 min, `jose`) + opaque refresh token (256-bit, stored hashed) in a
  family; rotation on every refresh; reuse of an old token revokes the whole family and alerts the user.
  Web: refresh token in `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/auth` on the API host (same site as
  the web app under `dubey.app`). Mobile/desktop: returned in the body, kept in OS secure storage.
- **Registration is closed**: the first sign-in with `OWNER_EMAIL` creates the owner; everyone else needs an
  invite link.
- New-device sign-in → notification to the user's other devices.

### access
- `users.role` (`owner` | `member`), `entitlements(user_id, key, enabled, limits)`; owner has everything.
- `@RequireEntitlement('today')` guard on controllers/gateway topics; sync scopes filtered by entitlements.
- Invites: owner creates (`email?`, preset entitlements, expiry, single use) → link → invitee signs in with
  email code or Google → account created with those entitlements.

### audit
Append-only `audit_log` (actor, action, target, ip, user agent, at) for sign-ins, refresh reuse, invites,
entitlement changes, device revocations.

### sync
- `change_log(seq bigserial, owner_id, entity, entity_id, op, fields jsonb, hlc, device_id, mutation_id unique)`.
- Entities register with the sync registry: name, entitlement key, zod schema, table, merge policy.
- `POST /sync/push` (batch of mutations; idempotent by `mutation_id`; field-level LWW by HLC; per-entity merge
  override) → `GET /sync/pull?cursor=` (changes since cursor for entitled entities, paginated) → ws ping
  `sync.changed {seq}` to the user's other devices.
- The first real entities arrive with Today (spec 0002); the engine is tested with a test entity.

### notify
- `notifications` (owner, module, kind, title, body, data, actions, priority, dedupe key, created, read_at,
  dismissed_at) + `push_targets` (device, channel: `webpush` | `fcm`, token/subscription).
- Pipeline: module calls `notify.send()` → stored → ws broadcast → BullMQ job delivers push per device
  (respecting quiet hours and per-module settings; urgent bypasses quiet hours) → email for `email: true` kinds.
- Dismiss/read on one device → ws event + FCM data message so other devices clear it.
- Web Push (VAPID, `web-push`), FCM HTTP v1 (service account via `google-auth-library`; configured later).

## apps/web (Next.js 15, React 19, Tailwind v4, Motion)
- Aurora Glass components: `Aurora` (circadian background), `Glass` (pane/float/halo), `Orb`, `Button`,
  `Input`, `Card`, `Sheet`, `Toast`/edge glow, `CommandBar`, `Avatar`, `Badge`, `Switch`, `Segmented`.
- Theme engine: phase from sun position (approximate solar times from the browser's time zone/locale, or
  coordinates if granted) with manual override (Auto/Dawn/Day/Dusk/Night, light/dark pin).
- Screens: sign-in (email code, Google, passkey), onboarding (add a passkey), home shell (module nav), devices,
  notification centre, settings (theme, quiet hours), admin (users, invites, entitlements), component gallery.
- PWA: manifest, service worker (offline shell, web push, notification actions), install prompt.
- Tests: Playwright (sign-in with email code via the dev mailbox endpoint, admin invite flow, entitlement hiding,
  notification arrives and dismisses).

## apps/mobile (Flutter 3, Android first)
Riverpod, go_router, drift (SQLite) for the local store, `flutter_secure_storage`, `dio`, web_socket_channel,
`firebase_messaging` (+ local notifications with actions), `local_auth`, `credential_manager`/passkeys plugin.
Theme from generated Dart tokens. Screens: sign-in, home shell, devices, notifications, settings, gallery.

## apps/desktop (Tauri 2)
Tray icon, start on login, native notifications with actions from the ws stream, sign-in via the system
browser (loopback redirect), token in Windows Credential Manager (keyring). Quick-capture hotkey reserved.

## apps/extension (React, Vite, Manifest V3)
Popup with sign-in (opens the web app to authorise the extension), connection state, placeholder quick capture.

## infra/
`docker-compose.yml` (api, worker, web, postgres, valkey, uptime-kuma, glitchtip), `Caddyfile`/Cloudflare
origin setup, `backup.sh` (pg_dump → age-encrypted → R2) + `restore-test.sh`, deploy script, `.env.example`.
