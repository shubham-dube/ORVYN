# Decisions

The founder's choices (newest first). Technical consequences are recorded as ADRs in `adr/`.

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
