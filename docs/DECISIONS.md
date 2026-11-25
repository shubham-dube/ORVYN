# Decisions

The founder's choices (newest first). Technical consequences are recorded as ADRs in `adr/`.

## Decided — 2026-11-25 (specs 0020 and 0021 — the founder's words)

| #        | Topic      | Decision                                                                                                                                                 |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0020-1 | All sites  | The extension may read every page (for filling, Recall, My Day). A Web Store refusal is acceptable.                                                      |
| D-0020-2 | Passwords  | Saving and generating are in; filling only after a click (ADR-0017).                                                                                     |
| D-0020-3 | Tracking   | The whole day, sites and what was done inside them, with presence from keyboard and mouse. Chosen for you: counts only, never the characters (ADR-0018). |
| D-0020-4 | Magic fill | From a structured profile. The AI maps labels to profile fields and never receives the values; drafts of long answers are asked for one by one.          |
| D-0021-3 | Terminal   | Commit, deploy, start the terminal. RustDesk over Tailscale for the screen, no root, spec 0022 after the terminal, Continuum last.                       |
| D-0021-2 | Terminal   | The design of ADR-0019 is accepted. It comes to the web and to Android.                                                                                  |
| D-0021-1 | Windows    | Full app tracking, reply from a toast, run commands on the PC from the phone. SmartScreen warning accepted; JobOS control in this tray; no Vault here.   |

## Decided — 2026-11-24 (spec 0019, notifications set your way — chosen for you; change any)

| #        | Topic        | Decision                                                                                                                                   |
| -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D-0019-1 | Channels     | In-app (always), Push, Urgent (through quiet hours, repeats), Alarm (rings), Email and WhatsApp copies. WhatsApp to partners stays manual. |
| D-0019-2 | Rules        | Per notification type, per person. Ways chosen on an item (a task’s reminder, a document’s expiry) win.                                    |
| D-0019-3 | Catalog      | One catalog in `packages/contracts`; a test fails when code sends a type that isn’t in it.                                                 |
| D-0019-4 | Off          | Off sends nothing, not even the bell (kept dismissed so dedupe and actions behave). Security can’t be off.                                 |
| D-0019-5 | Copies       | Email and WhatsApp go once, not on every repeat.                                                                                           |
| D-0019-6 | Brief nudges | Their on/off stays in the Brief’s settings; their ways come from the catalog rules.                                                        |
| D-0019-7 | Samples      | “Send me a sample” per type, at most once a minute.                                                                                        |

## Decided — 2026-11-24 (spec 0018, the Pool as a roster — chosen for you; change any)

| #        | Topic        | Decision                                                                                                                                                                                                  |
| -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0018-1 | Roster       | A round shows every active partner; statuses go To ask → Asked → Will apply → Money sent → Applied → Mandate done (or Can't / No reply / Missed). Any status can be set back; Undo restores the last one. |
| D-0018-2 | Track record | Per partner across rounds: applied N of M, missed K, the last one missed — shown in new rounds.                                                                                                           |
| D-0018-3 | The close    | At 5 pm on the close day: Will apply / Money sent → Missed, Asked → No reply; one summary notification; the round shows the summary.                                                                      |
| D-0018-4 | Messages     | Templates per moment with placeholders, edited by the owner, rendered by the server; asking moves To ask → Asked.                                                                                         |
| D-0018-5 | Moving back  | Changing a status never changes the ledger: money entries stay until removed by hand.                                                                                                                     |
| D-0018-6 | Mail counts  | The Mail entry shows the important count (not every unread); each mailbox shows unread and important.                                                                                                     |

## Decided — 2026-11-24 (spec 0017, Home and the smart inbox — chosen for you; change any)

| #        | Topic                 | Decision                                                                                                                                            |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0017-1 | Needs you, ordered    | Due today or overdue and money-related first, then replies people wait for, then the rest by importance; at most 8 on Home with "and N more".       |
| D-0017-2 | Which mail            | Unread from the last 7 days, up to 25 a mailbox, every 15 minutes; kept 14 days; still read-only (nothing is marked or moved in the mailbox).       |
| D-0017-3 | Triage                | By the AI in batches (cheap model, budgets apply), with rules when AI is off or failing. OTP codes are cut from previews before anything is stored. |
| D-0017-4 | Mail pings            | Only important new mail (needs reply, bill due within 3 days, security, VIP); at most 5 a day; on by default; switchable.                           |
| D-0017-5 | Senders               | VIP and Mute are taught by the person, per sender address, and win over the AI.                                                                     |
| D-0017-6 | Home layout           | Mission control: hero → now & next → needs you → today → money → mail → week → live → quick actions → modules. Empty blocks hide.                   |
| D-0017-7 | Mail is personal data | Like the Library (D4): on ORVYN's server, readable by the AI for triage only; the AI never acts on mail.                                            |

## Decided — 2026-11-24 (spec 0016, the IPO desk sharper and a Brief with a brain — chosen for you; change any)

| #        | Topic           | Decision                                                                                                                                                        |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0016-1 | IPO data        | The IPO Guru **calendar** call is the workhorse (every 3 h); spare calls fetch details; never more than one call a minute on the free plan.                     |
| D-0016-2 | Will you apply? | Asked on the "announced" and "opens" notifications and on the card. **I'll apply** makes one Today task; follow-ups on the close, allotment and listing days.   |
| D-0016-3 | Apply-by time   | **14:00** on the close day by default (bids close at 5 pm; UPI mandates slow down late), with a 09:30 reminder that morning. Changeable.                        |
| D-0016-4 | Mainboard first | The desk shows mainboard only until SME is switched on; the choice is synced in IPO settings.                                                                   |
| D-0016-5 | AI in the Brief | On by default when AI is set up: it writes the opening from the Brief's facts only (through the `ai` module, budgets apply). Off = rules' words. It never acts. |
| D-0016-6 | Weather         | Open-Meteo (free, no key) for the place chosen in Brief settings; no device location is sent.                                                                   |
| D-0016-7 | Markets         | Nifty 50 and Sensex from Yahoo's public chart endpoint, best effort; left out quietly when unavailable.                                                         |
| D-0016-8 | Credits         | "Data: IPO Guru" with a link stays visible wherever its data shows (their terms).                                                                               |

## Decided — 2026-11-23 (spec 0015, Vault in a second and chat that follows you — chosen for you; change any)

| #        | Topic              | Decision                                                                                                                                                |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0015-1 | Chat storage       | **Kept on the server, encrypted at rest** (ADR-0016), so every device has the whole history. End-to-end sealing (ADR-0014) is retired for new messages. |
| D-0015-2 | Old chats          | Carried over automatically by any device that can still read them; the server checks the sender's signature first.                                      |
| D-0015-3 | Chat pushes        | Show the sender and the text (last four unread lines), with Reply and Mark as read. Muted chats stay silent.                                            |
| D-0015-4 | Reactions          | One per person per message (tap yours again to remove it).                                                                                              |
| D-0015-5 | Vault fingerprint  | Android only, opt-in after a passphrase unlock; the vault key sits in keystore-backed secure storage behind the system prompt, never on a server.       |
| D-0015-6 | Vault smart add    | Recognised on the device by patterns (Luhn, otpauth, key prefixes) — never by the AI.                                                                   |
| D-0015-7 | Per-device choices | Theme, app lock, Vault fingerprint and auto-lock stay per device; everything else follows the person.                                                   |

## Decided — 2026-11-23 (spec 0014, What's in my hand — chosen for you; change any)

| #        | Topic           | Decision                                                                                                                                            |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0014-1 | In your hand    | **Accounts − card & loan dues − what you owe + money owed to you that is sure.** "Not sure" money is shown, not counted. Card limit is never yours. |
| D-0014-2 | Balances        | Typed once per account (as of a moment); later payments move them. ORVYN never reads a bank; check it against the bank app now and then.            |
| D-0014-3 | Money in        | A credit read from a message is **not counted until you say**: income, someone paying back, or not counted. Typed credits count at once.            |
| D-0014-4 | Debts and tasks | A debt with a due day adds a Today task; settling ticks it. Lending and being paid back are never spending or income.                               |
| D-0014-5 | Company PRs     | One GitHub connection **per token** (user + each organisation). Review requests become tasks dated the day the PR was raised; on by default.        |
| D-0014-6 | Public holidays | Holiday calendars arrive **hidden**; duplicates across accounts show once; one tap in Schedule hides them all.                                      |

## Decided — 2026-11-22 (spec 0013, Money brain — chosen for you; change any)

| #        | Topic            | Decision                                                                                                                             |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D-0013-1 | How it thinks    | **Rules, not AI**: counting the person's own payments. Free, instant, private.                                                       |
| D-0013-2 | Filing by itself | A captured payment is filed without asking only when that merchant was filed the same way **3+ times, ≥ 80%**; a quiet note says so. |
| D-0013-3 | Removing a rule  | Means **"ask me"** for that merchant from then on (history doesn't file it either).                                                  |
| D-0013-4 | Where it runs    | Web: in the browser. Android: `GET /money/insights`. Same function (`moneyInsights`).                                                |

## Decided — 2026-11-22 (spec 0012, Today refined — defaults chosen for you; change any)

| #        | Topic            | Decision                                                                                                                                                                                                    |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0012-1 | ClickUp in Today | Only **working** statuses show in Today: in-progress (custom) ones that aren't past building (fixed, QA, review, deployed, done…). Changed per account in "Show in Today"; the rest is on the ClickUp page. |
| D-0012-2 | Deadline         | A separate, optional **Deadline** next to **When** (the day you plan to do it). A task with only a deadline shows in Today once that day comes. "by / due / deadline …" in quick add sets it.               |
| D-0012-3 | Task status      | **To do · Doing** for ORVYN tasks; done stays `completedAt`. No custom statuses. The board's columns are these, plus Done today.                                                                            |
| D-0012-4 | Meetings         | Shown in the list and board; they **end by themselves** at their end time and fold under "Earlier today". A meeting is not a task.                                                                          |
| D-0012-5 | PR pings         | **Merged** and **changes requested** ping you; **approved** is off until you switch it on. One ping per change.                                                                                             |
| D-0012-6 | Quick add        | Nothing about a day written → **the Inbox** (the Today / Tomorrow / Someday chips are gone). The Orb and the command bar still add "to Today" because that's what they say.                                 |

## Decided — 2026-11-19 (spec 0011, Chat and Split — defaults chosen for you; change any)

| #        | Topic       | Decision                                                                                                                                                                          |
| -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0011-1 | Chat crypto | Sealed per device as D-0008-1, built from primitives both libsodium (web) and Dart `cryptography` (Android) provide, cross-tested (ADR-0014). New devices don't see old messages. |
| D-0011-2 | Split       | A shared group record the server can read (balances, plans, reminders), not end-to-end encrypted; guests (not on ORVYN) by a private read-only link (ADR-0015).                   |
| D-0011-3 | Settling up | The fewest transfers that clear everyone; a payment you record moves the balances. ORVYN never moves money.                                                                       |

## Decided — 2026-11-19 (spec 0010, IPO desk and Pool — defaults chosen for you; change any)

| #        | Topic         | Decision                                                                                                                                                                                                    |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0010-1 | IPO data      | **IPO Guru API** first (free plan: calendar, details, GMP; live subscription needs its ₹299/month plan). Until a key is set, figures can be typed in. GMP is always marked unofficial.                      |
| D-0010-2 | IPO Pool      | Balances come only from the ledger (never typed). Money left with a partner after a refund stays as **float** for the next IPO. Card cash costs are recorded at the time of transfer as a cost of that IPO. |
| D-0010-3 | Partner links | Each partner can get a private, revocable link (90 days) to confirm applied / allotted / sold; sent from your own WhatsApp in one tap.                                                                      |

## Decided — 2026-11-19 (spec 0009, Brief — defaults chosen for you; change any)

| #        | Topic         | Decision                                                                                                                                                                                   |
| -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-0009-1 | Brief timing  | **Off until you turn it on**; default 07:30 in your zone, any time can be chosen. One normal notification; quiet hours apply. When on, it replaces Today's morning task summary.           |
| D-0009-2 | Brief writing | **Rules, not AI**: facts already in ORVYN, counted and ordered, with a headline built from them. Free, instant, nothing leaves the server.                                                 |
| D-0009-3 | Nudges        | Four kinds (slipped tasks, budget drift, payments waiting, Drop piling up), **at most 2 a day**, only between your Brief time and 20:00, each switchable, never twice for the same reason. |

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
