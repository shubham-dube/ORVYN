# 0012 — tasks

Delivered 2026-11-22 on API, web and Android. Decisions: D-0012-1…6.

## Slice 1 — fixes and polish

- [x] 5 · Gmail errors carry Google's reason (`GoogleHttpError.reason`) and show what to do (`googleProblem`); guide
      updated. **Founder:** enable the Gmail API in the Google Cloud project.
- [x] 12 · Tools never say "nothing" before loading: placeholder rows, retry on error. Android providers are kept
      alive between visits; web has a stale-while-revalidate cache (`lib/work.ts`). The API caches ClickUp per
      account (2 min) and fetches workspaces in parallel.
- [x] 14 · One field look: Android `FocusRing` + `bareInput` + an app-wide `InputDecorationTheme` with no borders;
      the six hand-made borders replaced. Web: no outline inside inputs, a `field-ring` utility on every field and
      box (39 places).
- [x] 9 · Meeting "Who": one bordered box with chips and the input inline; a hint for half-typed emails.
- [x] 10 · "Add to ClickUp" removed from Today (web and Android). The endpoint stays one more round.
- [x] 11 · Inbox explained ("No day yet — give one a day to plan it."; "Inbox zero — everything has a day.").
- [x] 13 · Select mode: hold a row (or Select), square checkboxes, tinted rows, "n selected · Select all · ✕", a
      floating bar (Done · When · Project · Priority · Delete, delete confirms). Android also has swipe right = done,
      swipe left = tomorrow.
- [x] 1 · `doneLabel` / `doneDayHeader` (contracts + Dart port); "Done 3:40 pm" on rows; the Done tab grouped by
      day, a month at a time; "Done on Mon 16 Nov, 6:10 pm" in the sheet.

## Slice 2 — capture and the task model

- [x] `deadline` and `status` (todo · doing) in contracts, schema, migration `0025_today_refined`.
- [x] Parser: notes `//`, deadline `by/due/deadline/before <day>`, ranges `3-4pm`, any am/pm spelling, `3a`/`3p`,
      24-hour times, `1h30`/`1.5h`/`2 hrs`, `!high`/`urgent`/`asap`, `nov 22`. A new 87-case table (100%); the 0002 set
      stays at 203/205 (the same two misses as before).
- [x] Quick add on web and Android: understood chips only (tap to change, × to read literally), a ghost **Inbox**
      chip, an ⓘ tips sheet with examples, ⤢ (web also Shift+Enter) opens the full form with everything carried over.
- [x] Task sheet (new and edit): a big title, To do / Doing, fact pills (When · Time · Duration · Priority · Project
      · Deadline), "+" rows for notes, checklist, tags, repeat and reminders.

## Slice 3 — meetings in the list and board

- [x] Schedule group: time, length, Join (Meet/Zoom/Teams/Webex from the place or notes), soon / now (progress) /
      ended → "Earlier today"; ⋯ → follow-up task. Google Meet links now sync into the event's place (never written
      back).
- [x] Board: a schedule strip with what's on now and the next two.

## Slice 4 — board by status

- [x] Columns To do · Doing · Done today; project pill; drag between columns (Android: hold to drag, ⋯ → Move to).

## Slice 5 — ClickUp hub

- [x] API (`clickup.hub.ts`): working flags and settings, statuses, task detail (subtasks, comments, my time), status
      and priority, comments, time by start + minutes (never in the future), delete time, timer start / stop /
      current, closed tasks of 30 days, cache.
- [x] Web `/today/clickup` and Android `/clickup`: grouped by status (List / Board), search, list filter, closed on
      request; the task sheet; Add time (duration or range); a running-timer pill in Today's header.

## Slice 6 — GitHub pull requests

- [x] API: my PRs (open with review and checks; merged and closed, 30 days); the watcher pings merged / changes
      requested (approved when on); `PUT /connections/github/settings`.
- [x] Web `/today/prs` and Android `/prs`: three tabs; the GitHub card in Today; notification switches.

## Tests

- API: `connections-hub.test.ts` (15: default rule, cache, Show in Today, sheet, status and priority, comment, time,
  timer, owner scope for every endpoint, PRs, merge pings once, Gmail messages); `today.test.ts` (deadline and
  status sync). Full suite: 262/265; the 3 failures are the same on the code before this change
  (`brief.test.ts` nudges depend on today's date; two upload-size tests in `files`/`ai-files` fail on this Windows
  machine).
- Packages: today-parse 99, contracts 21, today-plan 62 — all pass.
- Web unit: 18 pass (new: a deadline puts a task in Today). **Playwright `today.spec.ts` and `today2.spec.ts` were
  rewritten for the new UI but not run here** (they need the full stack); run them in CI.
- Android: all tests pass, `flutter analyze` clean. New `today_refined_test.dart` (8: done labels, Done by day,
  deadline grouping, the ClickUp loading placeholder, timer + add time + comment, meetings, quick add → Inbox chip
  → full form). Seven older widget tests updated to the new behaviour.

## Follow-up fixes (2026-11-22, after trying it on the phone)

- Quick add saved the words raw when Add was pressed before the server's reading came back (fast tap, the tips
  examples, a slow network). It now waits for the reading (spinner on the button; offline → as typed).
- Sheets opened inside the shell's navigator, under the bottom nav. All glass sheets now open on the root navigator.
- The board and the day calendar had fixed heights under the nav; `FitAboveNav` sizes them to end above it.
- "Working on" decided only by ClickUp's status type. Now names count too (DESIGN, DEVELOPMENT, IN PROGRESS … in any
  case and of any type), and the apps apply the same rule when the server doesn't say. "Show in Today" falls back
  to the statuses of your open tasks, with Retry, when the full list can't be read.
- Web: sheets sit above the Orb (`z-[60]`).
- Production still ran the old API (new routes returned 404): the Pull requests page and the working flags need
  the deploy.

## Later

- Delete the unused `POST /connections/clickup/tasks` endpoint and `clickupLists`.
- An ongoing Android notification for a running timer.
- ClickUp attachments, custom fields, checklists; writing to PRs.
