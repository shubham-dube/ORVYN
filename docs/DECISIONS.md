# Decisions

The founder's choices (newest first). Technical consequences are recorded as ADRs in `adr/`.

## Decided — 2026-11-19 (round 0008 and the next modules)

| #        | Topic        | Decision                                                                                                                                                                                                                                      |
| -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0008-1 | Chat crypto  | **Sealed boxes with libsodium** (already audited and used for the Vault): each message encrypted for each recipient device. No forward secrecy for now; a stolen device key could read what that device kept. Move to MLS later. Resolves O8. |
| D-0008-2 | Next modules | **Brief, then Chat, then the IPO desk**; Jobs after.                                                                                                                                                                                          |
| D-0008-3 | Mail         | Zoho and other mailboxes join through **IMAP with an app-specific password** (works for any provider, no OAuth app to register); Gmail keeps its Google sign-in.                                                                              |

## Decided — 2026-11-18 (spec 0007, after the first deploy)

From your request ("use AI smartly so the bill is as low as possible"), recorded so you can change any of it:

| #        | Topic            | Decision                                                                                                                                                                                                                                                                        |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0007-1 | Payment review   | Every captured payment asks "what was it?" with buttons and a reply box. Replies are read by rules; only an unreadable reply goes to the cheapest model, which may only pick one of your categories. "always …" or the same answer twice makes ORVYN file that merchant itself. |
| D-0007-2 | Rules before AI  | Short typed text in Drop that ORVYN's own parsers understand (an amount with a money word, a task with a day or time, a meeting at a time) is proposed without any AI call.                                                                                                     |
| D-0007-3 | Models           | The cheapest model (Haiku) answers first for Drop and Library; **Fable (D13) is used only when that answer doesn't fit or looks unsure**. Refines D13. Routes can be changed with `AI_ROUTES` (`"escalate.<task>"` for the second try).                                         |
| D-0007-4 | Cache and images | The same question on the same content is answered from a per-person cache for 30 days (free, shown in usage). Photos are shrunk to 1568 px before sending (~85% fewer tokens). The $1/day cap (D19) is unchanged.                                                               |

## Decided — 2026-11-19 (steps 4–5, reminders everywhere, advanced tasks)

Decided by me from your request, recorded so you can change any of it:

| #   | Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D22 | Reminder ways | Any reminder can use any mix of: **Notification** (normal), **Hard notification** (urgent: ignores quiet hours and mute, comes back every 5 minutes up to 6 times until you act), **Alarm** (rings like an alarm; full-screen on Android, scheduled on the phone so it works offline; on other devices it is a hard notification), **Email**, **WhatsApp**. Defaults are yours (D17); each task can override. |
| D23 | WhatsApp      | Sent through the **WhatsApp Business Cloud API** (Meta). You need a Meta business app, a phone number id, an access token and one approved message template (steps in the deploy guide). A number is used only after you confirm it with a code sent to it. Needs credentials from you before it works.                                                                                                       |
| D24 | Vault crypto  | Argon2id → key-encryption key, random vault key, XChaCha20-Poly1305 per item, a recovery key shown once (ADR-0004). Web uses libsodium; Android uses the same algorithms through `cryptography` (pure Dart, tested against the web's output) because `sodium_libs` needs native builds that don't run in CI.                                                                                                  |
| D25 | Assistant     | The Assistant **reads** your Today, Money, Library and Drop (never the Vault) and **proposes** changes; nothing changes until you confirm each one (create, complete, move, expense, note). Deleting or changing money is always a confirm.                                                                                                                                                                   |
| D26 | Library       | Documents and photos are read by the AI to title, tag, summarise and pull out dates (expiry → reminder) and amounts (→ a Money suggestion). Everything in the Library is AI-readable (D4).                                                                                                                                                                                                                    |

## Decided — 2026-11-18 (step 3: Drop + Money)

| #   | Topic        | Decision                                                                                                                                                                       |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D18 | Banks (O7)   | Readers built and tested first for **HDFC, ICICI, SBI, Axis**, **credit cards of any bank**, and **GPay, PhonePe, Paytm** notifications; other banks get a general reader.     |
| D19 | AI budget    | ORVYN's AI (OpenRouter, D13) has a **$1 per day** cap. When reached it pauses and says so; waiting items continue the next day. Raising it needs the founder.                  |
| D20 | Auto-capture | Transactions read from bank/UPI messages are **added directly** (rules, not AI; the amount comes from the bank's message), shown in a "new" strip with one-tap fix or delete.  |
| D21 | Photos       | Dropped photos and receipts **may be sent to the AI model** to read them. Anything the AI proposes from them still needs one tap to confirm (AI never acts silently on money). |

## Decided — 2026-11-16 (second round)

| #   | Topic     | Decision                                                                                                                                                                                        |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D10 | Design    | **Aurora Glass approved** (design/principles.md and the linked canvas).                                                                                                                         |
| D11 | Domain    | `orvyn.dubey.app` (web) and `api.orvyn.dubey.app` (API).                                                                                                                                        |
| D12 | Sign-in   | Passkeys + Google + email one-time code (ADR-0003 accepted).                                                                                                                                    |
| D13 | AI        | Separate OpenRouter key and daily budget for ORVYN; Fable for Drop, Assistant and IPO analyst.                                                                                                  |
| D14 | Hosting   | Hetzner + Cloudflare + R2 accepted in principle; the account and keys come **after the foundation is built**. Until then everything runs and is tested locally/in CI; deploy scripts are ready. |
| D15 | Calendars | **Several Google accounts per person**, each with its own calendars switched on/off (Today spec Q1).                                                                                            |
| D16 | Planning  | **Working hours are the person's own and change over time**: weekly patterns that start on a chosen date, plus one-off day overrides; nothing hard-coded (Q2).                                  |
| D17 | Reminders | **Reminder defaults are settings the person controls** (timed items, date-only items, digest or not); every task can override them (Q3).                                                        |

## Decided — 2026-11-16

| #   | Topic          | Decision                                                                                                                                                                                                                                                                                |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Name           | **ORVYN** (repo `shubham-dube/ORVYN`). The assistant inside is also called Orvyn.                                                                                                                                                                                                       |
| D2  | Phones         | **Android + iPhone.** Android: native Flutter app on Play Store. iPhone: until there is an Apple developer account, the installable web app (PWA) — with home-screen icon, offline and push notifications. The Flutter app is built iOS-ready so it can ship the day an account exists. |
| D3  | Code layout    | **One new monorepo** (this repo). JobOS stays in its own repo and connects through its API.                                                                                                                                                                                             |
| D4  | Documents & AI | **Everything in the Library is AI-readable** (encrypted at rest on the server; the AI can read, categorise and search it). **Secrets go to the Vault**, which is zero-knowledge: unreadable to the server and to the AI.                                                                |
| D5  | First feature  | Foundation, then **Tasks + Calendar**.                                                                                                                                                                                                                                                  |
| D6  | Hosting        | **Cheapest setup that still includes everything production needs** (backups, monitoring, TLS, push, file storage). See `architecture/hosting-and-cost.md`.                                                                                                                              |
| D7  | Design         | Glassmorphism, perfectionism in small details, light **and** dark, striking motion, original ideas. See `design/principles.md`.                                                                                                                                                         |
| D8  | App stores     | Play Store first. No Apple developer account yet.                                                                                                                                                                                                                                       |
| D9  | Users          | The founder plus **5–50 friends**, with features enabled per person by the founder.                                                                                                                                                                                                     |

## Open — needed before the step that uses them

| #   | Question                                     | Needed for                                     | Recommendation                                |
| --- | -------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| O3  | Google Play developer account ($25 one-time) | First Android release (internal testing track) | Create when the Tasks + Calendar MVP is ready |
| O8  | Chat encryption library (licences differ)    | Chat                                           | decide in Chat spec                           |
