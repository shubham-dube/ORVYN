# Spec 0009: Brief — your morning, and quiet nudges

Status: Delivered 2026-11-19 (API, web, Android) · Roadmap step 7 (features.md #10; D-0008-2) · Module: `brief`

## Problem

Everything ORVYN knows is spread over Today, Money, Drop, Library, your tools and your mail. Each module pings on its
own. In the morning you want **one** calm look at the day, and during the day only the few nudges that matter.

## User stories

- At the time I choose, one notification: "Good morning — 3 meetings, 5 tasks", and a Brief page with today's timeline,
  money since yesterday, what waits in Drop, documents running out, my GitHub/ClickUp work and unread mail.
- I can open the Brief any time (web, Android, Home card) and refresh it.
- A few nudges in the day, with strict rules: things that slipped (with **Move to today**), a budget drifting, payments
  waiting for a look, Drop piling up. At most two a day by default, never in quiet hours, each one switchable.
- When the Brief is on it replaces Today's morning task summary, so nothing arrives twice.

## Design

**Written by rules, not AI (D-0009-2).** The Brief is facts already in ORVYN, counted and ordered; a headline is built
from them ("3 meetings, 5 tasks · first at 10:00"). No model call, no cost, nothing sent anywhere.

**Sections** (each only if the person has that module, and only if it has something to say):

| Section | From                                | Shows                                                                            |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| Agenda  | Today (tasks, events incl. repeats) | events today in order; tasks due today, overdue count, the top few by priority   |
| Money   | Money                               | spent yesterday, this month, budgets at or over 80%, payments waiting for a look |
| Drop    | Drop                                | how many things wait for a decision                                              |
| Library | Library                             | documents expiring in the next 30 days                                           |
| Work    | Connections (GitHub, ClickUp)       | issues assigned, reviews waiting, ClickUp tasks due                              |
| Mail    | Connections (Gmail + IMAP)          | unread mail this week, per mailbox                                               |

The Brief reads other modules' data read-only, exactly like the Assistant (spec 0005); it writes only through sync
(Move to today) and its own tables. External calls (GitHub, ClickUp, IMAP) have timeouts; a failing one is left out.

**When (D-0009-1).** Off until the person turns it on (no surprise notifications). Default time 07:30 in their zone;
any time can be chosen. A per-person BullMQ scheduler (cron in their zone) builds it, stores it (`briefs`, one per
day) and sends one normal-priority notification (`brief:<day>`), which waits out quiet hours like any other.

**Nudges (D-0009-3).** Every 30 minutes, between the Brief time and 20:00 local, once the day's Brief has gone out:

| Kind       | When                                                             | Actions                    | At most        |
| ---------- | ---------------------------------------------------------------- | -------------------------- | -------------- |
| `slipped`  | 3 or more open tasks overdue                                     | Move to today · Open Today | once a day     |
| `budget`   | a budget at 80% with more than 30% of the month left, or at 100% | Open Money                 | once per level |
| `payments` | 5 or more captured payments not looked at for a day              | Open Money                 | once a day     |
| `drop`     | 3 or more Drop items waiting for more than a day                 | Open Drop                  | once a day     |

At most `maxNudges` (default 2) a day across kinds, in the order above; each kind can be switched off. Expiring
documents are not a nudge: the Library already reminds before expiry (spec 0004).

## API

- `GET /brief/today` — today's Brief (built now if none yet); `POST /brief/today/refresh` — build it again.
- `GET /brief/history?days=7` — the last week's Briefs.
- `GET /brief/settings`, `PUT /brief/settings` — `{ enabled, at: "HH:MM", sections: [...], nudges: { enabled, kinds:
[...], max } }`.
- Notification action `move_today` on a `slipped` nudge: overdue tasks get today's date (through sync, so every device
  sees it).

Entitlement `brief` (ADR-0005), checked on every endpoint and by the scheduler; each section also checks its module.

## Clients

- **Web:** `/brief` (sidebar, command bar), a Brief card on Home, settings in a sheet on the Brief page.
- **Android:** Brief in the launcher and a Home card; the same settings sheet.

## Acceptance criteria

- [x] AC1 A Brief shows only the person's own data and only sections for modules they have (two-person test).
- [x] AC2 With the Brief on, it is built and sent once at the chosen time in the person's zone; off sends nothing.
- [x] AC3 With the Brief on, Today's morning summary is not sent as well.
- [x] AC4 Nudges respect the daily cap, the window and their switches; none is sent twice for the same reason.
- [x] AC5 "Move to today" moves the overdue tasks through sync; nothing moves without the tap.
- [x] AC6 Web and Android show the Brief and its settings; tests cover both.

## Open questions

- Should the Brief also arrive by email or WhatsApp (D22 ways)? Notification only for now.
- An evening "tomorrow" look? Later, if wanted.
