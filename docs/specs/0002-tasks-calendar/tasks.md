# Tasks 0002: Today

## M1 — tasks and projects end to end

- [ ] api: `today` module — project/task tables, migrations, sync entities with validation, owner isolation tests
- [ ] packages/sync-client: Dexie mirror + outbox + pull, HLC merge, socket nudges; tests shared with the Dart client's cases
- [ ] web: Inbox + Today list, quick add (command bar + Orb), task sheet, complete with "settle" animation, offline
- [ ] mobile: Inbox + Today list, quick add from the Orb, task sheet, offline, haptics
- [ ] e2e: create on web → appears on phone (live API test) and vice versa; airplane-mode edit merges

## M2 — natural language

- [ ] packages/today-parse + 200 fixtures (≥ 97%), Indian conventions
- [ ] api `/today/parse` (+ cheap-model fallback via the ai module, budgeted)
- [ ] chips UI on web and Android

## M3 — reminders

- [ ] worker scheduler + digest; notify actions done/snooze/later/tomorrow
- [ ] Android shade actions without opening the app; web/PWA, Windows, extension actions

## M4 — events and the Time River

- [ ] events + recurrence (RRULE + exceptions); Time River web + Android; week/month

## M5 — Google Calendar, auto-plan, widgets

- [ ] Google two-way sync; auto-plan with reasons; Android widget; Windows quick-add hotkey
