# Spec 0002: Today — tasks + calendar

Status: Approved scope (D5) · plan.md written · Phase 2 · Module: `today` · Accent: sky

## Problem

Tasks and calendar live in different apps, entering them is slow, and reminders are dumb. "Today" is one
timeline of everything with time in it, filled by talking or typing naturally, that tells you what matters now.

## User stories

- I type or say "dentist fri 11 for 45m" or "pay rent every 1st" and it is created correctly without forms.
- I open the app and see the Time River: now, next, and free time; I drag a task into free time to block it.
- I get reminded on the device I am using, with actions (done, snooze 10 m, later today, tomorrow morning).
- My Google Calendar events (and invitations) appear and stay in sync both ways.
- One tap "plan my day" lays unscheduled tasks into free slots around my events; I can adjust.
- I capture from anywhere: the Orb, a home-screen widget, the share sheet, Windows hotkey, the extension.

## Scope

**In:** tasks (title, notes, checklist, due, scheduled time block, duration, priority, project/list, tags,
recurrence RRULE, reminders), events (own + Google Calendar), natural-language parser (rules first, small
model fallback, Indian date conventions), Time River view, week/month views, inbox (unscheduled), projects,
search, reminders via the notify pipeline with actions, Google Calendar two-way sync, auto-plan, Android widget,
quick capture on all surfaces, offline.
**Out (later):** sharing tasks with friends (after Chat), location reminders, time tracking.

## Acceptance criteria (draft)

- [ ] AC1 Parser: 200-case test set (English + common Hinglish phrasing, relative dates, recurrence, durations,
      time zones) ≥ 97% exact.
- [ ] AC2 Reminder fires on time (±30 s) with working actions on Android, web/PWA and Windows; done/snooze on
      one device updates all.
- [ ] AC3 Google Calendar: create/edit/delete either side reflected within 1 min; recurring events and
      exceptions correct; no duplicates after reconnects.
- [ ] AC4 Offline: create/edit/complete on a phone in airplane mode; syncs cleanly later.
- [ ] AC5 Time River renders 60 fps on a mid-range Android; reduced-motion variant.
- [ ] AC6 Auto-plan never moves fixed events, respects working hours and buffers; explains each placement.

## Decisions (founder, 2026-11-17)

- **Q1 → D15 Several Google accounts.** Connect any number of Google accounts; each account's calendars are listed
  and switched on/off one by one; a new event can be saved to any writable calendar; disconnecting one account
  removes only its events. Default for newly found calendars: on if you own or can edit it, off if read-only.
- **Q2 → D16 Working hours are yours, and they change.** A person keeps _working patterns_: each is a week
  (per weekday, any number of ranges, or none) that applies **from a chosen date** until the next pattern starts —
  so "from 1 Dec I work 9–5" is set once, ahead of time, and history stays correct. One-off **day overrides**
  ("Sat 20 Dec 10–14", "Mon off") beat the pattern. Buffers and "don't plan after" are settings too. Auto-plan
  always reads what applies on the day it plans. No defaults are assumed beyond an editable starting pattern.
- **Q3 → D17 Reminders are settings.** Defaults for timed items (any number of lead times, e.g. 1 day + 10 min),
  for date-only items (a digest at a time you choose, a ping at a time you choose, or nothing), and whether overdue
  items roll into the digest. Every task can override with its own reminders.

These live in one synced `today.settings` record per person (edited on any device, used by the server's reminder
scheduler and auto-plan).
