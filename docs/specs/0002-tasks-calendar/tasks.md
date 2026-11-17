# Tasks 0002: Today

## M1 — tasks and projects end to end

- [x] api: `today` module — project/task tables, migrations, sync entities with validation, owner isolation tests
- [x] packages/sync-client: Dexie mirror + outbox + pull, HLC merge, socket nudges; tests shared with the Dart client's cases
- [x] web: Inbox + Today list, quick add (command bar + Orb), task sheet, complete with "settle" animation, offline
- [x] mobile: Inbox + Today list, quick add from the Orb, task sheet, offline, haptics
- [x] e2e: create on web → appears on phone (live API test) and vice versa; airplane-mode edit merges

## M1.5 — the person's own settings (D15–D17)

- [x] contracts + api: `today.settings` (one per person) with working patterns, day overrides, buffers, reminder defaults; tests
- [x] pure helpers (TS + Dart, same cases): working ranges for a date, effective reminders for a task
- [x] web + Android: Settings → Today (patterns from a date, day overrides, reminder defaults); per-task reminders in the task sheet

## M2 — natural language

- [x] packages/today-parse + 205 fixtures (99.0% exact; the 2 misses are recorded ambiguities), Indian conventions + Hinglish
- [x] api `/today/parse` (the person's zone and projects; removed chips read literally)
- [ ] cheap-model fallback for phrases the rules leave unexplained — waits for the `ai` module (not built yet); rules are at 99%
- [x] chips UI on web (local parse, offline) and Android (server parse; offline saves the words as typed); Orb / Ctrl-K too

## M3 — reminders

- [x] worker scheduler from the person's settings (nothing assumed before they save) + summary/ping at their time and zone; actions done / snooze 10 min / later today / tomorrow applied as server changes that sync everywhere
- [x] Android shade actions without opening the app (3 buttons max there, all 4 in-app); web/PWA (via the page), Windows toasts (all 4), extension (2 in the toast, all in the popup); in-app buttons on web and Android

## M4 — events and the Time River

- [x] packages/today-plan: RFC 5545 occurrences in the person's zone (DST-safe), next occurrence never in the past, event expansion with cancelled and changed occurrences; tests
- [x] api: `today.calendar` + `today.event` entities (migration 0007) with shape, ownership and read-only checks; repeating tasks roll forward when ticked off on any device (`lastDoneAt`, checklist reset); events remind with the person's timed defaults; tests
- [x] web: List | Calendar; the day as a river (blocks, overlaps side by side, now line, free time from the person's hours, drag or Place a task, double-click for an event, all-day strip); week and month; event sheet with repeats and "only this one / all of them"; e2e
- [x] Android: List | Calendar; river with hold-and-drag or Place, week agenda, event sheet with the same rules (rrule package for expansion); widget tests
- [x] label palette in design tokens (contrast-tested) for calendars and projects

## M5 — Google Calendar, auto-plan, widgets

- [x] Google two-way sync (`calendar` module): several accounts per person (D15), OAuth code + PKCE, tokens encrypted with libsodium, calendars shown as Google shows them, incremental sync with sync tokens and paging, push channels + 5-minute poll, write-back with etags (insert, patch, one occurrence, delete), Google wins on conflict, reconnect needed → told once, disconnect revokes; tested against a fake Google
- [x] Settings → Calendars on web and Android (connect another account, reconnect, sync now, show/hide, disconnect; colour on web)
- [x] auto-plan with a reason per placement and an explanation for what didn't fit; local on web, `POST /today/plan` for Android; nothing changes until accepted; refuses to guess without working hours (D16)
- [x] Android home-screen widget (home_widget + Kotlin provider; colours generated from tokens)
- [x] Windows quick-add hotkey (shortcut chosen in the tray, or off; same parser and sync); live API test
- [ ] needs from the owner: a Google OAuth client with the Calendar API enabled and `CALENDAR_TOKEN_KEY` in production (docs/guides/run-locally.md, deploy.md)
