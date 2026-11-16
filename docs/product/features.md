# Features

Priorities: **P0** foundation · **P1** first daily-use features · **P2** next · **P3** later.
Each feature gets its own spec before it is built; the "Decide" column lists what the founder must choose then.

## Build order
| # | Feature | Priority | Surfaces | Decide when its spec is written |
|---|---|---|---|---|
| 0 | **Foundation** — login, devices, design system, sync, notifications, feature switches, admin | P0 | all | sign-in methods |
| 1 | **Tasks + Calendar** ("Today") | P1 | all | Google Calendar sync depth; recurring rules |
| 2 | **Drop** (universal inbox) — basic: text, voice, photo → task / event / note | P1 | all | which model; confirmation rules |
| 3 | **Money** — expense tracking with automatic capture | P1 | all | banks/UPI apps; categories; budgets |
| 4 | **Vault** — secrets (zero-knowledge) | P2 | all | unlock rules; recovery; autofill |
| 5 | **Library** — documents, images, notes, auto-organised | P2 | all | storage limits per friend; sharing |
| 6 | **Assistant** — chat over your data that can act | P2 | all | what it may do without asking |
| 7 | **Chat** — end-to-end encrypted, with friends | P2 | mobile, web, desktop | groups; media; protocol library |
| 8 | **IPO desk** (India) | P3 | mobile, web | data sources; your rules for "apply" |
| 9 | **Jobs** — JobOS inside ORVYN | P3 | mobile, web | what can be approved from the phone |
| 10 | **Brief** — morning summary and proactive nudges | P3 | all | timing; channels |

## Feature notes (the ideas behind each)

### 0. Foundation
- Sign in with Google, email code, and passkeys (fingerprint/face). Device list with remote sign-out.
- **Feature switches:** the founder (admin) turns modules on or off per person. Enforced by the server.
- **One notification system** for every module: Android push, web push (also iPhone via the installed web app),
  Windows tray, optional email. Dismiss on one device, gone on all. Quiet hours. Per-module controls.
- Offline-first sync engine reused by every module.

### 1. Tasks + Calendar — "Today"
- **One timeline, not two apps.** Tasks and events live on the same day view; a task can be dragged onto a time
  to block it.
- **Type or speak naturally:** "call Nandini tomorrow 5pm", "pay rent every 1st", "dentist fri 11 for 45m".
- **Now strip:** what you should be doing right now, what is next, how long until it.
- **Smart snooze:** "later today", "tomorrow morning", "when I'm at my desk" (desktop online), "next free slot".
- **Auto-plan:** one tap lays unscheduled tasks into free time around events; you adjust.
- Google Calendar two-way sync so existing events and invitations appear.
- Capture from anywhere: phone widget, share sheet, Windows hotkey, Chrome extension, Drop.

### 2. Drop — universal inbox
- One button everywhere. Text, voice, photo, screenshot, file, link, forwarded email.
- The AI proposes what it is (expense / task / event / document / note / secret → vault prompt) with the
  fields filled; one tap confirms, a swipe corrects. Corrections teach it.
- Starts simple (tasks, events, notes) and gains abilities as modules ship.

### 3. Money
- **Automatic capture:** Android reads bank and UPI SMS and payment notifications on the device and turns them
  into transactions (raw messages never leave the phone unparsed without consent). iPhone/web: statement
  emails, receipt photos, voice ("spent 240 on lunch"), CSV/PDF statement import.
- Auto-categorised, merchants cleaned up ("UPI-RAZ*SWIGGY" → Swiggy · Food), duplicates merged, transfers
  between own accounts recognised.
- Budgets, subscriptions detection, month story ("what changed vs last month"), split with a friend.

### 4. Vault (zero-knowledge)
- Passwords, cards, IDs, API keys, recovery codes, secure notes, files.
- A separate vault passphrase + biometrics; auto-locks; needs re-authentication every time it is opened;
  clipboard auto-clear; screenshot blocking on Android; breach check without revealing the password.
- A printed recovery kit. Without the passphrase or kit, nobody — including us — can open it.

### 5. Library
- Any file. On upload it is read (OCR where needed), named, tagged, grouped into collections automatically
  ("Identity", "Insurance", "College", "Bills → Electricity → 2026").
- Extracts dates and numbers that matter: expiry → reminder, amount due → Money, event → Calendar.
- Ask in plain language: "my PAN card", "the rent agreement", "insurance that expires this year".
- AI-readable by decision; anything that must be unreadable to the server goes in the Vault instead.

### 6. Assistant
- Talks to all enabled modules with the person's permissions. Shows sources. Confirms before changing things.
- Never sees the Vault.

### 7. Chat
- One-to-one and small groups, end-to-end encrypted with an established protocol library; the server relays
  ciphertext only. Text, photos, files, voice notes, reactions, replies.
- Share an ORVYN object into a chat (a task, a split expense, a document) as a live card.

### 8. IPO desk (India)
- Calendar of open and upcoming mainboard and SME IPOs with dates, price band, lot size, issue size.
- Live subscription numbers by investor category; unofficial grey-market premium clearly marked unofficial.
- **AI analyst:** reads the prospectus (RHP), financials and peers; gives strengths, risks, valuation versus
  peers and a verdict with its reasoning — *apply / avoid / only for listing gains* against rules you set.
- Reminders: opens, closes tomorrow, allotment, listing. Tracks how past verdicts turned out, in the open.
- Analysis, not advice; the app never places an application.

### 9. Jobs (JobOS)
- JobOS stays its own system. ORVYN shows matches, the review queue and application status, lets you approve
  from the phone, and routes JobOS notifications through ORVYN's notification system.

### 10. Brief
- Morning: today's timeline, money since yesterday, things expiring, IPO and job items needing a decision.
- Proactive nudges with strict rules so it stays quiet.
