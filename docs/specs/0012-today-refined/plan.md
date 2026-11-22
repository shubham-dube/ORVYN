# 0012 — plan

Six slices, each shipped end to end (API → web → Android → tests → docs) before the next (AGENTS.md "one niche at a
time"). The order puts quick, visible fixes first and the big ClickUp work after the foundations it needs.

## Slice 1 — Fixes and polish (items 5, 9, 10, 11, 12, 13, 14, 1)

| Item | Where                                                                                                                 | Change                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 5    | `api/.../calendar/google.client.ts` `call()`; `connections.service.ts` `mail()`                                       | Parse Google's `error.errors[0].reason` into `GoogleHttpError.reason`; map it to readable text. Founder: enable the Gmail API in GCP. |
| 12   | `mobile/lib/features/tools.dart:188`, web `components/tools.tsx`                                                      | `AsyncValue.when(loading → skeleton, error → retry, data → rows/empty)`; cache the connection list; `skipLoadingOnRefresh`.           |
| 14   | `mobile/lib/design/controls.dart` + app theme; six hand-made `OutlineInputBorder`s; web `ui/field.tsx`, `globals.css` | One `InputDecorationTheme`; a `FocusRing` container for embedded fields; web `focus-within` ring and `outline-none` on inner inputs.  |
| 9    | `mobile/lib/features/connections.dart` MeetingSheet "Who"; web counterpart                                            | A chip-input field in one bordered box; comma/space/Enter → chip; email validation.                                                   |
| 10   | `tools.dart` "Add to ClickUp" + `ClickUpAddSheet`; web `tools.tsx`                                                    | Remove from the UI (keep the endpoint one round).                                                                                     |
| 11   | the Inbox section in `today_screen.dart`, web `task-views.tsx`                                                        | Header hint and empty-state copy.                                                                                                     |
| 13   | `_TaskRow` and the select bar in `today_screen.dart`; web `task-views.tsx`                                            | Checkbox morph, tint and edge, long-press entry, a floating action bar with When/Project/Priority/Done/Delete.                        |
| 1    | a `doneLabel(completedAt, now, tz)` helper in contracts, plus a Dart port; Done section                               | Day headers in Done; "Done …" on rows and in the sheet.                                                                               |

Tests:

- an API unit test for the Gmail reason mapping;
- a web vitest for `doneLabel`;
- a Flutter widget test that the tools widget shows a skeleton and not "Nothing assigned" while loading;
- golden tests of the field focus state.

## Slice 2 — Capture and the task model (items 7, 8, 15)

1. **Contracts.** `TaskFields.deadline` (isoDate, nullable) and `status` (enum, default `todo`); `doneLabel`.
2. **Migration** (drizzle): add the two columns, and backfill `status='done'` where `completed_at is not null`.
3. **Sync merge.** Setting `status=done` sets `completedAt` (and the other way round), in the API's task merge and
   in `sync-client`.
4. **Parser** (`packages/today-parse`):
   - a time normaliser (`3am/3 AM/3a/3.30pm/1500/at 3`);
   - ranges (`3-4pm`), durations (`1h30`, `1.5h`);
   - `p1–p3`, `!high`;
   - `by/due <date>` → deadline, `// notes` → notes;
   - new span kinds `deadline` and `notes`.
   - A data-driven test table of 150+ rows. `/today/parse` (Android) gets it for free.
5. **Quick add (web and Android):**
   - remove the `_When` chips;
   - show the understood chips, each with a picker, plus the ghost `Inbox` chip;
   - add the ⓘ syntax tip and ⤢ expand.
6. **Task sheet:** a new-task mode; When / Deadline / Status; progressive "+" rows.
7. **Reminders and Brief:** a deadline adds a "due tomorrow" line to the digest (no new notification kind).

## Slice 3 — Meetings in List and Board (item 6)

- A shared `eventsOn(date)` selector over the synced events. It already exists for the calendar, so reuse the
  expander from `today-plan`.
- Add the Schedule group (with its states) to the List, and the schedule strip to the Board.
- "Make a follow-up task" opens quick add pre-filled.
- A ticker updates the state every 30 s. There is no stored state.

## Slice 4 — Board by status (item 16)

- Columns by `status`, with a project pill and a swimlane toggle on web.
- Drag between columns → a `status` update. On the phone, use long-press drag plus "Move to".
- The Done column shows today only.

## Slice 5 — ClickUp hub (items 2, 3)

1. **`clickup.client.ts`:** add the calls listed in spec B4. Fake ClickUp server routes go in the API tests.
2. **`connections.service.ts`:**
   - a per-connection cache (2 min, stale-while-revalidate) and parallel workspaces;
   - `workingStatuses` in `meta`, with the default rule;
   - statuses per list (1 h cache);
   - the task detail, status, comments, time entries and timer;
   - back off on 429.
3. **Controller:** the new endpoints with zod bodies. Every query looks up the connection by `(id, ownerId)`
   (rule 5); an owner-scope test for each endpoint.
4. **Web and Android:**
   - the ClickUp screen (list/board, grouped by status, filters, search);
   - the ClickUp task sheet;
   - the status picker, the Add time sheet and the running-timer pill;
   - "Show in Today" in Connections;
   - Today's Work group, working only, with the "n more" footer.
5. **Watcher:** keep the "new task assigned" pings. A status change made by someone else to a working-status task
   is _not_ pinged (too noisy).

## Slice 6 — GitHub pull requests (item 4)

1. **`github.client.ts`:**
   - `myPrs()`: open with `author:@me`, plus merged/closed in the last 30 days;
   - `reviewsOf(repo, n)`;
   - `checksOf(repo, sha)`.
2. **`connections.service.ts`:** `githubPrs()`; the watcher tracks my open PR numbers and their last review
   state, and pings on merged / changes requested (switchable per kind, kept in `meta.pings`).
3. **Web and Android:** the Pull requests screen (3 tabs) and the Today widget row.
4. **Connection help:** add the token permissions (Pull requests: read, Commit statuses: read).

## Not in this round

- Notion, Slack, Outlook.
- ClickUp attachments, custom fields, checklists, docs.
- Writing to GitHub PRs (merge, review).
- An ongoing Android notification for the running timer (it can come with the Windows tray).
