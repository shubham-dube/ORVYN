# Spec 0008: Push on the new Firebase method, more connections, mail into tasks, a calm Android

Status: Approved scope (founder, 2026-11-19) · Modules: notify, connections, today, Android

## Why

- Firebase deprecated registration tokens: apps register with a **Firebase Installation ID (FID)** (`register()` /
  `onRegistered`, manifest flag `firebase_messaging_installation_id_enabled`), servers send with `message.fid`
  (`message.token` is deprecated and only accepts FIDs during the transition). Spec 0001 O10.
- The founder works in GitHub, ClickUp, Gmail and **Zoho Mail**; ORVYN should be where that work lands.
- Drop, Library, Vault and Settings on Android still have the old, busy layout; People and Mail exist only on web.

## Plan

**A — Push on FIDs.** The phone registers and reports its FID (`kind: fcm`, `format: fid`); the server sends to
`message.fid` for those and keeps `message.token` for older phones until they re-register; unregister on sign-out.

**B — Connections, end to end.**

- GitHub (several accounts, personal token, read + issues scope): issues assigned to me and pull requests waiting for
  my review, in Today ("From GitHub"); close an issue, approve is left to GitHub (open link). Notifications when
  something new is assigned or a review is requested.
- ClickUp: besides seeing and closing tasks, create a task in a chosen list from ORVYN, change its due date.
- Mail (several accounts): Gmail (read-only add-on) and **any IMAP mailbox with an app password** — Zoho
  (`imap.zoho.in` for India accounts, then `imap.zoho.com`), Outlook/Hotmail, Yahoo, custom. Unread mail from the last
  week in one Mail view; **Make a task** turns a mail into a task (title from the subject, a due date when the
  subject/snippet names one — our own parser first, the cheap model only when asked), keeping a link back.
- Passwords and tokens sealed (TokenBox); IMAP passwords are app-specific passwords, never the account password.

**C — Calm Android.** Drop, Library, Vault, Settings rebuilt in the Today/Money style (one composer, quiet rows,
details on demand, sticky sheets); People (owner) and Mail on the phone.

- Drop: what waits is grouped — _Ready for you_ (the suggestion in words and one-tap **Add**; Edit opens the full
  editor in a sheet), _Reading_, _Needs a hand_ (why, then Make it a task / Keep as a note); Done folds away.
- Library: one **Add** button (photo, gallery, file, voice, note in a sheet), search, category chips, documents as
  quiet rows grouped by category with only the badge that matters (running out).
- Vault: lock and settings in the header, search with **New**, items as rows grouped by kind.
- Settings: an index — who you are, then rows (Light, Notifications, Working hours, Connections, Calendars, Mail, AI,
  Security & devices, People) each opening its own page (`/settings/:section`).
- People (`/people`, owner): everyone with what they can open and when they were last seen; a switch per module;
  pause/resume; invite by link (shown once).
- Mail (`/mail`): unread mail per mailbox, one mailbox or all, any mail into a task.

## Out

Outlook calendar, Notion, Slack (connections listed as coming); sending mail.
