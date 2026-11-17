# Plan 0002: Today — tasks + calendar

Built on the foundation: sync engine (ADR-0006), notify pipeline, entitlement `today`, Aurora Glass on every
surface. Order follows "one niche at a time": each milestone ships api → web → mobile → notifications → tests.

## Data (api module `today`, all synced entities, owner-scoped, `deleted_at` + change log)

| Entity           | Fields (beyond id/owner/timestamps)                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `today.project`  | name, colour (module accent palette only), order, archived                                                                                                                                                                                                                                       |
| `today.task`     | title, notes, checklist (json), projectId, tags[], priority 0–3, due (date or datetime + tz), scheduledStart/End (time block), durationMin, rrule, recurrenceParentId + originalStart (exceptions), completedAt, reminders (json: offsets or absolute), source (`typed`/`spoken`/`orb`/`email`…) |
| `today.event`    | title, notes, start/end + tz, allDay, location, rrule + exceptions, calendarId, external (provider, ids, etag)                                                                                                                                                                                   |
| `today.calendar` | provider (`orvyn`/`google`), name, colour, visible, writable, sync cursor                                                                                                                                                                                                                        |

Recurrence: RFC 5545 RRULE via `rrule` (TS, `packages/today-plan`) / `rrule` (Dart, read-only expansion); instances
are expanded on the client for a window, in the event's wall-clock time. A changed occurrence is its own event
(`recurringEventId` + `originalStart`); a cancelled one is an exception on the series (`exdates`) — or, from Google, a
cancelled override. A repeating **task** is a single row that rolls forward: when it's ticked off (any device,
offline, or "Done" on a reminder) the server moves it to its next occurrence — never one already past — and records
`lastDoneAt`; an ended repeat stays done.

## Natural-language parser (`packages/today-parse`)

Rules first (chrono-node with an Indian-conventions refiner: dd/mm, "kal", "parso", "subah/shaam/raat", "1st of
every month", IST default), then a cheap-model fallback through the `ai` module only when the rules leave tokens
unexplained. Output is a _proposal_ shown as chips the person can tap to fix — never silently created wrong.
200-case fixture set (`fixtures/*.json`) gates CI at ≥ 97% exact (AC1). The API exposes `/today/parse` for clients
without the package (Android uses it online; offline it saves the raw text as an inbox task and parses on sync).

## Reminders

Reminder defaults come from the person's `today.settings` (D17), a task's own `reminders` override them. A `today.reminder` scheduler in the worker: on every task/event change, (re)compute the next fire time and keep
one BullMQ delayed job per item (idempotent job id). Firing sends through notify with actions
`done`, `snooze_10m`, `later_today`, `tomorrow_9`; actions arrive as API calls from any device and update the
task through the sync engine, so every device converges (AC2). Morning digest for date-only tasks (Q3).

## Clients

- **packages/sync-client** (TS): IndexedDB (Dexie) mirror + outbox, the same algorithm as the Dart client; used
  by web and extension.
- **Web**: Time River (today), Inbox, Upcoming (week), Month, Projects, search; quick add in the command bar and
  the Orb; task sheet; drag a task into free water to time-block it; keyboard first.
- **Android**: Time River, Inbox, Upcoming, task sheet, quick add from the Orb; notification actions work from the
  shade without opening the app (background isolate with its own session); home-screen widget (M5).
- **Windows / extension**: toasts with the same actions; quick add hotkey (Windows) and popup field (extension).

## Google Calendar (M5, needs an OAuth client) — api module `calendar`

Several accounts per person (D15): `calendar_accounts` (tokens encrypted with libsodium, `CALENDAR_TOKEN_KEY`) and
`calendar_sync_state` per calendar. Each account's calendars become `today.calendar` rows written by the server
(devices may only show/hide/recolour them). Incremental sync with `syncToken` (paging, full re-sync on 410 that also
removes what Google no longer has) + push channels (`events.watch`, HMAC channel token) when the API is public, and a
poll every 5 minutes; writes go out with `If-Match` etags; on 412 Google's version wins and every device converges.
Recurring events map to RRULE + EXDATE, moved/cancelled instances to overrides. ORVYN ids are derived from
(calendar, Google id) and matched by `externalId`, so re-syncs and reconnects never duplicate (AC3). The Google base
URLs are configurable; tests run against a fake Google.

## Auto-plan (M5)

Deterministic scheduler (no LLM needed to place): fixed events are walls; working hours, buffers, priorities and
due dates order the rest; each placement carries a one-line reason ("due today, 45 m, fits before 3 pm call").
The person accepts or drags (AC6). `planDay` in `packages/today-plan` runs locally on web; Android asks
`POST /today/plan`. No working hours saved → it says so instead of assuming any (D16).

## Milestones

| M   | Ships                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Tasks + projects end to end: API entities + tests, sync-client, web Inbox/Today list + quick add, Android list + quick add, offline both |
| M2  | Parser package + 200 fixtures + `/today/parse`; chips UI on web and Android                                                              |
| M3  | Reminders with actions on Android, web/PWA, Windows, extension; morning digest                                                           |
| M4  | Events + Time River on web and Android; recurrence; week/month                                                                           |
| M5  | Google Calendar two-way sync; auto-plan; Android widget; Windows hotkey                                                                  |
