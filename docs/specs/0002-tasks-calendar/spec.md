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

## Open questions (proposed defaults — founder to confirm; the code makes each one a setting)

- **Q1 Google Calendar accounts:** start with one Google account per person (multi-account later, same model);
  show every calendar you own or have write access to; subscribed/read-only calendars off by default.
- **Q2 Working hours for auto-plan:** Mon–Fri 10:00–19:00 (Asia/Kolkata), 15-minute buffers, nothing planned
  after 22:00; editable per person.
- **Q3 Default reminders:** timed tasks and events 10 minutes before; tasks with only a date get a 09:00
  morning digest instead of one ping each; overdue tasks roll into the next digest.
