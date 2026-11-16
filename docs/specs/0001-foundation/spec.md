# Spec 0001: Foundation

Status: Draft · Phase 1 · Related: ADR-0002…0008, DECISIONS O1/O2/O4/O5

## Problem
Every feature needs the same base: who you are, which devices you use, what you are allowed to see, data that
works offline and syncs, notifications that reach you everywhere, and a design system that makes it all look
like one product. Built once, properly, before any feature.

## Scope
**In:** monorepo + CI; design tokens + component kits (web, Flutter); auth (passkeys, Google, email code);
devices & sessions; roles & per-person entitlements; admin console (invite friends, toggle modules, quotas);
sync engine (server + Dart + TS clients); notification pipeline (FCM, Web Push incl. iPhone PWA, Windows
companion, email); Windows companion shell (tray, notifications, hotkey placeholder); Chrome extension shell
(sign-in, quick capture placeholder); deploy (Docker Compose, Cloudflare, R2), encrypted backups with restore
test, monitoring.
**Out:** any feature module (Today is spec 0002).

## Acceptance criteria
- [ ] AC1 The founder signs in with a passkey on Android, web and Windows; Google and email code work as
      fallback; a new device sign-in alerts other devices.
- [ ] AC2 Admin invites a friend by link, chooses enabled modules; the friend sees only those — server rejects
      access to others (tested for API, websocket and sync).
- [ ] AC3 A test notification from the server reaches Android, web/PWA (incl. iPhone home-screen app) and the
      Windows companion within 5 s; dismissing it on one dismisses it on all.
- [ ] AC4 Sync: an item created offline on the phone appears on web after reconnect; concurrent edits to
      different fields merge; to the same field resolve deterministically (tests with simulated clocks).
- [ ] AC5 Design system: tokens generate CSS + Dart; circadian palette switching, light/dark pinning, three
      glass levels, springs, reduced motion; a component gallery page on web and in Flutter.
- [ ] AC6 Deploy: one command to deploy; HTTPS on the chosen domain; nightly encrypted backup and an automated
      restore test that passes; uptime + error monitoring alert the founder.
- [ ] AC7 Security: rate limits on auth; refresh-token reuse revokes the family; audit log of sign-ins and
      admin actions; CSP and security headers; secret scanning in CI.

## Open questions
- O4 sign-in methods (recommended: passkeys + Google + email code)
- O5 design direction
