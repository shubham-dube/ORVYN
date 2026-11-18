# Spec 0006: Reminders everywhere, advanced tasks, Money v2, the dashboard

Status: Approved scope (founder request 2026-11-19; D22, D23)

## Reminders in any way

Each reminder (a task's own, or the person's defaults) chooses any of: Notification, Hard notification, Alarm, Email,
WhatsApp. Hard = urgent, repeats every 5 min up to 6 times until acknowledged, ignores quiet hours (D22). Alarm rings
full-screen on Android, scheduled on the phone (offline-safe); elsewhere it is a hard notification. Email uses the
account's address; WhatsApp needs a confirmed number (D23). Acknowledging (Done, Snooze, Dismiss, open) on any device
stops the repetition everywhere.

AC: each way delivers (tests with a fake mail outbox and a fake WhatsApp server); repetition stops when acknowledged;
quiet hours hold normal ones but not hard/alarm; a number must be confirmed first; per-task choices override defaults;
the Android alarm is scheduled locally from synced tasks.

## Advanced tasks

Repeat builder (every N days/weeks/months/years, weekdays, month day / nth weekday, until a date or after N times) with
a human summary and next dates preview; subtasks (checklist with progress), tags, priority, duration, project;
saved filters and search; views (Today, Upcoming, Inbox, Board by project, All); projects with colours; bulk
complete/move; per-task reminder ways; keyboard-first quick add stays.

**Built (web, Android, API):** the shared repeat builder in the task sheet (never / daily / weekly with weekday circles /
monthly by date or "2nd Friday" / yearly, every N, ends never / on a date / after N times, plain summary, next five
dates); steps (checklist with a progress bar, shown on rows and cards); tags with suggestions; duration; projects
(create from the sheet or the board) with colours; priority on every row; search (title, notes, tags, steps) and
filters (project, tag, priority, when) — one rule set in TypeScript and Dart (`fixtures/task-query.json`); saved
filters (`today.filter`, synced); List / Board / Calendar views and All / Today / Upcoming / Inbox / Done scopes; bulk
select (complete, move to project, set day, set priority, delete). Board columns move by drag on web and by long-press
on Android. A repeat with no day starts today.

## Money v2

Add an expense for **any date and time** (quick entry understands "yesterday", "on 12 nov"; a full form with date
picker; edit date later); accounts and categories management; recurring expenses and income (rent, subscriptions,
salary) that appear on their day; search and filters (text, category, account, amount, dates, direction); CSV export;
split an expense into parts (category split); tags; "show the whole year" view.

**Built (web, Android, API):** any date/time in quick entry (`parseSpend` + shared `fixtures/spend.json`, 25 cases, same
reader in TypeScript and Dart) and in the full form (day chips, date picker, optional time; a future day is refused
unless it repeats); scheduled entries (`money.recurring`, server job adds each due day once via a per-day dedupe key,
catches up at most 62 days, or only reminds) with the shared repeat builder (`packages/today-plan/src/repeat.ts`,
`apps/mobile/lib/app/repeat.dart`, shared `fixtures/repeat.json`); accounts and categories management (add, rename,
archive); search and filters (text, category, account, direction, all time); export as CSV (web download, Android
copy-as-text).

**Not yet:** splitting one expense across categories, tags UI, a whole-year view, amount and date-range filters. They
are small follow-ups once the dashboard is done; nothing else depends on them.

## Dashboard

Home becomes a real dashboard on web and Android: a greeting with the day's shape, what's next (events and tasks), a
progress ring for today's tasks, money this month vs budget with a sparkline, Drop waiting, documents expiring soon, an
Assistant prompt, quick actions, and the module shortcuts — all from the person's local data (offline).
