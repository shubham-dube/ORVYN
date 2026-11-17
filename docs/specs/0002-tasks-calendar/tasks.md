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

- [ ] events + recurrence (RRULE + exceptions); Time River web + Android; week/month

## M5 — Google Calendar, auto-plan, widgets

- [ ] Google two-way sync; auto-plan with reasons; Android widget; Windows quick-add hotkey
