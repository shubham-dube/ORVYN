# 0012 — Today, refined: tasks, meetings, ClickUp and GitHub without leaving ORVYN

Status: **Delivered** (API, web, Android) — decisions D-0012-1…5 (defaults chosen, 2026-11-22). Tasks: [tasks.md](tasks.md).
Surfaces: API, web, Android. Builds on 0002 (Today), 0007 C2 / 0008 B (connections).

## Why

Today works, but it is not yet the one place for the day's work. Done tasks lose their date. ClickUp shows every
open status, so "Fixed", "QA" and "Prod deployed" sit next to what is actually being built. Meetings show on the
calendar but not in the list or board. Quick add misses common ways of writing a time. ClickUp still has to be
opened for statuses, comments and time. Pull requests are not shown at all. Some controls also look unfinished:
doubled focus borders, a select mode that doesn't look selected, a widget that flashes "nothing assigned" while it
loads.

The goal is that a working day runs from ORVYN. ClickUp and GitHub are opened only for rare jobs.

## Principles for this round

1. **Type once.** Quick add reads date, time, duration, priority, project, tags, deadline and notes. Chips show
   what it understood; tapping a chip changes it. No date written means the Inbox.
2. **Show what I'm working on, keep the rest one tap away.** Today shows only _working_ ClickUp statuses. Every
   other status is in the ClickUp screen, grouped and filterable.
3. **One field style everywhere.** One border, and focus changes that border's colour. A field is never a box
   inside a box.
4. **Every list has a loading state, an empty state and an error state**, and they never look the same.
5. **Simple first.** New fields stay hidden until they are used ("+ Deadline", "+ Notes").

---

## A. Tasks (ORVYN's own)

### A1 — When a task was done (item 1)

- Each done row shows its completion time:
  - today: `Done 3:40 pm`
  - yesterday: `Done yesterday, 6:10 pm`
  - this week: `Done Mon, 6:10 pm`
  - older: `Done 18 Nov`
  - another year: `Done 18 Nov 2025`
- The **Done** tab is grouped under sticky day headers (`Today`, `Yesterday`, `Mon 18 Nov` …), newest first, with
  a count per day. It loads 30 days at first, then more on scroll.
- The task sheet of a done task says `Done on Mon 18 Nov, 6:10 pm` and has **Not done** to reopen it.
- A done repeating task shows `Last done …`, read from `lastDoneAt`.

### A2 — A clear task model (items 15, 16)

Two new fields. Everything else already exists.

| Field      | Meaning                                                                      | Shown as                                      |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| `deadline` | **new.** The last day it may be done (YYYY-MM-DD). Optional.                 | flag chip; amber 2 days before, red when past |
| `status`   | **new.** `todo` · `doing`; done is `completedAt` (so the two never disagree) | board columns, a dot on list rows             |
| date/time  | existing `dueDate`/`dueAt`: **the day I plan to do it** (puts it in Today)   | "Today 3 pm", "Fri"                           |
| duration   | existing `durationMin`                                                       | "45m" on the row, block length on calendar    |

- In the UI, "due date" means the plan day, labelled **When**. Deadline is a separate, optional field. So "work on
  the report Monday, it's due Friday" fits in one task.
- `status` holds only `todo` or `doing`; "done" stays `completedAt`. The sync merges per field, so two fields that
  both meant "done" could disagree; this way they can't. Reopening a task keeps the status it had. Old clients that
  know neither new field keep working: the defaults (`deadline: null`, `status: 'todo'`) fill in.
- A task with only a deadline appears in Today (or Overdue) once that day comes, and waits in the Inbox before.
- Migration `0025_today_refined`: `deadline text null`, `status text not null default 'todo'`.

### A3 — Full task sheet for new tasks (item 8)

- A small **⤢ (expand)** icon at the right end of quick add. It opens the full task sheet for a _new_ task,
  pre-filled with what was typed and understood.
- The sheet layout, top to bottom:
  - title
  - chips row: When · Time · Duration · Priority · Project
  - "+ Deadline", "+ Repeat", "+ Reminder", "+ Tags", "+ Checklist", "+ Notes"
- Only what is set is expanded. Everything else stays a single "+" line, so the sheet stays short.
- On web the same sheet is a right-side panel. The shortcut `Shift+Enter` in quick add opens it.

### A4 — Quick add that understands more (item 7)

The parser (`packages/today-parse`) is extended. It is still rules only, with the AI as a fallback only on submit
and only for unread date words (ADR-0010).

| Piece    | Forms that must all work                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time     | `3am` `3AM` `3 am` `3 A.M.` `3a` `3p` `3pm` `15:00` `3:30pm` `3.30 pm` `at 3` (→ next 3 o'clock in working hours) `noon` `midnight` `morning/evening/tonight` `subah/shaam/raat` |
| Date     | `today` `tod` `tmr` `tmrw` `tomorrow` `kal` `parso` `fri` `friday` `next fri` `this weekend` `in 3 days` `22/11` `22 nov` `nov 22` `22nd` `end of month` `eom`                   |
| Duration | `for 45m` `45 min` `1h` `1 hr` `1.5h` `1h30` `1h 30m` `90m` `2 hrs`                                                                                                              |
| Range    | `3-4pm` `3pm-4:30pm` `3 to 5` → time and duration together                                                                                                                       |
| Priority | `!` `!!` `!!!` · `p1` `p2` `p3` · `!high` `!med` `!low` · `urgent` `asap`                                                                                                        |
| Deadline | `by fri` `due fri` `deadline 30 nov`                                                                                                                                             |
| Project  | `@work` (as today; an unknown name offers "create project Work")                                                                                                                 |
| Tags     | `#design #frontend`                                                                                                                                                              |
| Notes    | everything after `//` (or `--` followed by a space)                                                                                                                              |
| Repeat   | `every day` `daily` `weekdays` `every mon` `every 1st` `every 2 weeks` (as today)                                                                                                |

Case, spaces and dots never matter. The test table holds at least 150 phrasings, written as data, so a new form is
one line in the table.

**The short way to write it** (shown once as a tip, and always under ⓘ in quick add):

```
<what> <when> <time> [for <duration>] [!!] [@project] [#tag] [by <deadline>] [// notes]

call mom tmr 6pm for 15m !! @home // ask about the trip
review PR fri 3-4pm @work #frontend by mon
pay rent every 1st !
```

### A5 — No Today/Tomorrow/Someday chips (item 8)

- The three fixed chips go. They duplicated the parser and sometimes contradicted it.
- Under quick add, only **what was understood** is shown, as chips: `📅 Tomorrow` `⏰ 6 pm` `⏱ 15m` `!! High`
  `@Home` `// note`.
  - Tapping a chip opens its picker. The × on a chip means "read this literally" (as today).
  - When nothing about a date was written, one ghost chip `📥 Inbox` shows where the task will go. Tapping it picks
    a day.

### A6 — Inbox vs Today (item 11)

- **Inbox** holds tasks with no day yet: captured and not planned. **Today** holds tasks planned for today, plus
  overdue ones.
- The Inbox header gets one muted line: "No day yet — give one a day to plan it." The empty state reads "Inbox
  zero — everything has a day."
- The model does not change.

### A7 — Select mode that looks like select mode (item 13)

- To enter select mode: long-press a row, or tap the Select icon.
- In select mode:
  - each row's completion circle turns into a **square checkbox**, which animates in;
  - a selected row gets an accent tint (10%), a 2 px accent edge on the left and a filled check, plus a light
    haptic;
  - the top bar becomes `3 selected · Select all · ✕`.
- A floating action bar sits at the bottom: **Done · When · Project · Priority · Delete**. Delete asks to confirm.
- Back, Esc or ✕ leaves select mode.

### A8 — Board grouped by status (item 16)

- Board columns are **To do · Doing · Done (today)**. Columns scroll sideways on the phone and are snapped one per
  screen with a peek of the next one.
- A **project pill** above the board reads `All projects ▾`. Choosing a project narrows the board to it.
- With _All_, each card carries its project's colour dot. There is a "Group by project" toggle that turns the board
  into swimlanes on web; on the phone it shows collapsible project sections inside each column.
- Drag a card between columns to change its status. On the phone, long-press to drag, or use the card's ⋯ → Move
  to.
- The Done column shows only tasks done today. "See all done" links to the Done tab.
- ClickUp tasks get the same board, with columns for their list statuses, in the ClickUp screen (B2).

---

## M. Meetings in the list and board (item 6)

- Today's events (meetings and time blocks from every visible calendar) appear **in the List** as event rows.
  Their place is by start time inside a **Schedule** group at the top of Today:
  - a time column (`3:00 pm`), the title, the duration (`45m`), and a Meet/Zoom **Join** button when there is a
    link;
  - the attendees' avatars, two at most, then +n.
- Event states are computed and never stored:
  - **Upcoming:** normal.
  - **Starting soon** (10 min before): an accent outline and "in 8 min".
  - **Now:** a pulsing dot, "ends in 20 min", and a thin progress bar.
  - **Ended:** muted, and moved into a collapsed "Earlier today (2)".
- Meetings end **automatically at their end time**. Nothing needs ending by hand, because a meeting is not a task.
  Each event row's ⋯ has **"Make a follow-up task"**, which opens quick add pre-filled with
  `follow up: <title> // notes`.
- **Board:** a slim "Today's schedule" strip above the columns shows the next two events and a "Now" one if any.
  Events are not cards, because they have no status.
- Tapping an event opens the existing event sheet.

---

## B. ClickUp, without opening ClickUp (items 2, 3, 10, 12)

### B1 — Working statuses only, in Today (item 2)

- Each ClickUp connection stores `workingStatuses`, the status names that mean "I'm on this". ClickUp names
  statuses per list, so this is a choice, not a rule.
- **Default:** every in-progress status (ClickUp type `custom`), except names matching
  `fix|deploy|prod|release|qa|review|test|verif|done|complete|closed|block|hold|cancel|backlog|archiv`. Not-started
  statuses (type `open`, e.g. "to do") and closed ones don't count. The founder can change the list in
  Connections → ClickUp → "Show in Today". That screen shows all statuses found in their lists, as toggles with
  ClickUp's colours.
- Today's **Work** group shows only those tasks. A muted footer reads `14 more in other statuses →`, which opens the
  ClickUp screen.

### B2 — The ClickUp screen (item 3)

A full screen, reached from the Work group footer, the tools widget header and the launcher.

- **Header:** a search field, a filter button (Space / List / Status / Due), and a `List | Board` switch.
- **List view:** grouped by status, in ClickUp's colour and order. Each group is collapsible and shows a count.
  Working statuses are expanded and the rest collapsed. A row shows the name, the list, the due date (red when
  overdue), a priority flag, and a ⏱ when a timer runs on it.
- **Board view:** a column per status. Drag a card to change its status.
- Done and closed tasks are fetched only when that group is opened (`include_closed=true`, last 30 days).

### B3 — ClickUp task sheet

A full-height sheet on the phone and a side panel on web. Top to bottom:

1. **Header:** the task name, `Space › List` and ↗ Open in ClickUp.
2. **Status pill** in the status colour. Tapping it opens a status picker with the list's statuses in order, the
   current one ticked. The change is optimistic, and reverts with a toast if ClickUp refuses.
3. **Facts row:** Due (date picker, existing endpoint), Priority (Urgent/High/Normal/Low), Assignees (avatars, read
   only).
4. **Timer card:**
   - The big ▶ Start or ■ Stop button, with the live running time while it runs.
   - The total tracked on the task, mine and everyone's.
   - **+ Add time** opens a sheet with two tabs:
     - **Duration:** `1h 30m` (typed or stepper) and the date (default today).
     - **Range:** date, from and to times.
     - Both have an optional note and a "billable" toggle if the workspace uses it.
   - The list of my time entries, each with a duration, date and note. Swipe to delete, with a confirm.
5. **Description:** ClickUp's markdown, read only, collapsed after 6 lines.
6. **Subtasks:** name, status dot and a tick, if any.
7. **Comments:** the newest at the bottom, with avatar, name, time and text (mentions shown as names). A composer
   is pinned at the bottom. Sending is optimistic.

**A running timer is visible everywhere.** A small pill sits in the Today header (`⏱ 0:42:10 · Login page`). Tapping
it opens the task, and ■ stops the timer. The running entry comes from ClickUp, so a timer started in ClickUp shows
here too.

### B4 — API (all owner-scoped, tokens never leave the server)

New ClickUp client calls (v2):

- `GET /list/{id}` (statuses, cached for 1 h)
- `GET /task/{id}?include_subtasks=true`
- `PUT /task/{id}` (status, priority)
- `GET/POST /task/{id}/comment`
- `GET /team/{team}/time_entries/current`
- `POST /team/{team}/time_entries/start` and `/stop`
- `POST /team/{team}/time_entries` (manual: start + duration)
- `GET /team/{team}/time_entries?task_id=…`
- `DELETE /team/{team}/time_entries/{id}`

ORVYN endpoints, under `/connections/clickup/…`:

- `tasks?scope=working|all|closed`
- `tasks/:id`
- `tasks/:id/status`
- `tasks/:id/comments`
- `tasks/:id/time`
- `timer` (GET current, POST start, POST stop)
- `statuses`
- `settings`

**Cache (fixes item 12 at the source).** The task list is kept per connection for 2 minutes and returned at once,
with `stale: true` while a refresh runs. Today never waits on every workspace in series: workspaces are fetched in
parallel.

Rate limits: ClickUp allows 100 requests/min per token. A 429 backs off and serves the cache.

### B5 — Remove "Add to ClickUp" (item 10)

The button and `ClickUpAddSheet` are removed from Today on web and Android. The endpoint stays, unused, so old
clients don't break, and is deleted next round.

### B6 — The tools widget's loading flash (item 12)

- **Cause:** the widget renders `provider.value ?? []`. While it loads, that is an empty list, so it says "Nothing
  assigned to you". The connections list also loads first, so the whole widget pops in late.
- **Fix:**
  - **Loading:** two skeleton rows, shown under a header that is visible at once. The connection list is cached
    locally, so the header is known.
  - **Empty:** only when the data has loaded.
  - **Error:** "ClickUp didn't answer · Retry".
  - **Refresh:** pull-to-refresh keeps the old rows and shows a thin progress line.
- The same pattern applies to GitHub and Mail.

---

## G. GitHub pull requests (item 4)

- A **Pull requests** screen in three tabs:
  - **Mine — open:** `is:pr is:open author:@me`.
  - **To review:** existing.
  - **Mine — merged/closed:** the last 30 days, with Merged (violet) or Closed (grey) shown on each row.
- Each row shows:
  - the repo and #number, the title, and Draft;
  - the review state (Approved ✓ / Changes requested / Waiting), from the latest reviews;
  - checks (✓ / ✗ / ●), from the combined status of the head commit, fetched for open PRs only;
  - the age (`3d`);
  - ↗ to open it.
- In **Today**, the tools widget shows `3 open PRs · 1 approved` as one row that opens the screen.
- **Merge notifications.** The 15-minute watcher remembers my open PR numbers. When one becomes merged it sends "PR
  merged: <title>" (one per PR, with a dedupe key), and the same for "changes requested" and "approved". This
  replaces relying on the Gmail mail. It can be switched off per kind.
- Token permission needed: Pull requests: read, plus Commit statuses: read for checks. The connection help text is
  updated.

---

## X. Mail error (item 5)

- **What happens:** `GET /gmail/v1/users/me/messages → 403` while the account _has_ `gmail.readonly`. With the scope
  granted, a 403 from Gmail is almost always **`accessNotConfigured`**: the **Gmail API isn't enabled in the Google
  Cloud project** behind `GOOGLE_WEB_CLIENT_ID`. Calendar works because that API _is_ enabled.
- **Fix, for the founder:** Google Cloud Console → the ORVYN project → APIs & Services → Library → **Gmail API →
  Enable**. If the OAuth consent screen is in _Testing_, the `gmail.readonly` scope must be listed there, and the
  account must be a test user.
- **Fix, in code:** `GoogleHttpError` keeps Google's `error.errors[0].reason`. The mail box shows a readable cause:
  - `accessNotConfigured`: "Gmail API is off in your Google Cloud project — enable it (link)".
  - `insufficientPermissions`: "Gmail permission missing — reconnect with Gmail".
  - `rateLimitExceeded` and 5xx: "Gmail is busy, retrying".
  - The raw `GET … : 403` text is never shown.

---

## U. Field and form polish (items 9, 14)

- **One field style** (`OrvField` on Android, `Field` on web), used everywhere: the fill, a 1 px edge, and on focus
  the _same_ edge turns accent with a soft 3 px outer glow. It is never an inner second border.
- **Embedded fields** sit inside a bordered container: quick add in its Glass card, chat composer, search pills,
  the meeting "Who" box. They have **no border of their own**, and the container shows focus (its edge turns
  accent).
  - Android: a single app-wide `InputDecorationTheme`. `InputDecoration.collapsed` is used inside containers, and a
    `FocusRing` wrapper lights the container.
  - Web: the `focus-within:` ring is on the container, and `outline-none` is on the inner input, since the global
    `:focus-visible` outline currently draws inside the box.
- An audit covers every `TextField`/`<input>` on Today, the task sheet, the meeting sheet, ClickUp, connections and
  search, then the rest of the app in the same change. There are six hand-made `OutlineInputBorder`s on Android
  today.
- **Meeting "Who" (item 9).** Yes, it is needed: invitations go to these addresses. The guests field becomes one
  bordered box holding the chips with the input inline after them. It shows the hint "name@email.com, Enter to
  add", and a comma, space or Enter turns the text into a chip. A bad email shows a red chip. People already met
  are suggested.

---

## Screens and sheets, at a glance

| Screen / sheet          | New / changed | Where it opens from                                   |
| ----------------------- | ------------- | ----------------------------------------------------- |
| Today · List            | changed       | Schedule group, Work group (working only), done times |
| Today · Board           | changed       | status columns, project pill, schedule strip          |
| Today · Done tab        | changed       | day headers                                           |
| Quick add               | changed       | understood chips, ⓘ syntax tip, ⤢ expand              |
| Task sheet (new + edit) | changed       | When, Deadline, Status, progressive "+" rows          |
| Select action bar       | new           | long-press / Select                                   |
| ClickUp screen          | new           | Work footer, tools widget, launcher                   |
| ClickUp task sheet      | new           | any ClickUp row                                       |
| Status picker           | new           | status pill (ClickUp and own tasks)                   |
| Add time sheet          | new           | ClickUp task sheet                                    |
| Running timer pill      | new           | Today header (when a timer runs)                      |
| ClickUp "Show in Today" | new           | Connections → ClickUp                                 |
| Pull requests screen    | new           | tools widget, launcher                                |
| Meeting sheet · Who     | changed       | Schedule a meeting                                    |

## Acceptance (per area; tests named in plan.md)

- A done task, on every surface, shows its day and time per A1. The Done tab groups by day.
- Each of the 150+ quick-add phrasings in the table yields the expected fields (unit tests, shared by web and API).
- Nothing about a date written ⇒ Inbox. There are no fixed Today/Tomorrow/Someday chips.
- Today's Work group lists only working statuses. Changing "Show in Today" changes it on the next load.
- From the ClickUp sheet: change the status, comment, start/stop the timer, and add time by duration and by range.
  Each is checked against a fake ClickUp, and each is owner-scoped (rule 5).
- A PR that becomes merged gives exactly one notification.
- The Gmail 403 with `accessNotConfigured` shows the readable cause.
- The tools widget never shows an empty state before its data has loaded.
- No field anywhere shows a border inside a border on focus (screenshot test of quick add, task sheet, meeting
  sheet).

## Decisions (2026-11-22, defaults chosen; see DECISIONS.md D-0012-1…5)

- **Q1 — Working statuses:** detected automatically (B1), changed in "Show in Today".
- **Q2 — Deadline:** a separate, optional field next to When; hidden until added.
- **Q3 — Own-task status:** To do · Doing, plus done (`completedAt`). No custom statuses.
- **Q4 — Meetings:** end by themselves at their end time; ended ones fold under "Earlier today".
- **Q5 — PR pings:** merged and changes requested on; approved off (switchable).
