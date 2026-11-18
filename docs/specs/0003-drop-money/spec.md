# Spec 0003: Drop + Money

Status: Approved scope (roadmap step 3; D13, D18–D21) · plan.md written · Phase 3 · Modules: `drop` (slate),
`money` (emerald)

## Problem

Things to remember arrive everywhere (a thought, a screenshot, a voice note, a receipt) and spending happens in
a dozen apps. Writing either down by hand doesn't last. Drop is one place to throw anything; Money fills itself
from the messages the bank and UPI apps already send.

## User stories

- I tap the Orb (or share from any app) and drop text, a voice note, a photo, a screenshot, a file or a link. ORVYN
  proposes what it is — a task, an event, an expense or a note — with the fields filled. One tap confirms; I can
  change anything first. My corrections make the next proposals better.
- I pay with GPay or my card; within seconds the expense is in Money with a clean merchant ("Swiggy · Food"),
  without me typing anything. If my bank SMS and the GPay notification describe the same payment, it's one entry.
- I type or say "spent 240 on lunch" and it's an expense. A receipt photo becomes an expense with the right total.
- I import a bank statement (CSV) and only the transactions I don't already have are added.
- I see this month: spent, earned, by category, against my budgets; what changed versus last month; my
  subscriptions.
- My friends who have Money see only their own money.

## Scope

**In:** Drop items (text, voice turned into words by the device's speech recognition, photo, file, link) with AI proposals and one-tap
confirm/correct, share sheet on Android, Drop from the Orb / command bar / extension popup; Money accounts,
transactions, categories (editable defaults), budgets (monthly, per category or overall), automatic capture on
Android from bank SMS and UPI/card notifications (notification access, on-device parsing), manual and
natural-language entry, receipts via Drop, CSV statement import with duplicate detection, transfers between own
accounts, merchant clean-up, subscriptions detection, month story; the `ai` module (routing, budget, ledger) and
the `files` module (encrypted at rest); the Today parser's AI fallback (step 2 leftover); quick add in the Chrome
extension popup (step 2 leftover).
**Out (later):** split with a friend (after Chat), PDF statements, investment accounts, iPhone SMS (not
possible), bank account aggregation APIs.

## Acceptance criteria

- [ ] AC1 SMS/notification readers: fixture set for HDFC, ICICI, SBI, Axis, credit cards, GPay, PhonePe, Paytm
      (plus non-transaction messages that must be ignored: OTPs, offers, balance alerts) — 100% on fixtures in
      both TypeScript and Dart.
- [ ] AC2 The same payment seen as a bank SMS and a UPI notification is one transaction; re-reading never
      duplicates; a CSV import adds only what's missing.
- [ ] AC3 Drop: text, voice (transcript), photo and link items get a proposal; confirming creates exactly the
      proposed task/event/expense; nothing is created without the tap; a correction is used as an example next
      time.
- [ ] AC4 AI budget: when the $1 day cap is reached, AI work pauses with a clear message and resumes the next
      day; no request goes out after the cap.
- [ ] AC5 Raw bank/UPI messages never leave the phone; only the parsed transaction syncs.
- [ ] AC6 Every Money and Drop query is owner-scoped (tests); a person without the module is refused by the
      server.
- [ ] AC7 Files are encrypted at rest with their own key; a stolen bucket is unreadable.

## Decisions

D18 banks and apps first; D19 $1/day AI cap; D20 captured transactions are added directly with easy undo; D21
photos may be read by the AI, proposals still need a tap. Voice is turned into words by the device's own speech
recognition (Android's recogniser, the browser's) — audio never reaches ORVYN's server (no extra cost).
Currency: INR by default, each transaction keeps its own currency.

## Open questions

- Which apps' notifications to read beyond D18 (Amazon Pay, CRED, bank apps)? The general reader covers most;
  add on request.
