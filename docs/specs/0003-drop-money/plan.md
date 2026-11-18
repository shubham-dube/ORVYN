# Plan 0003: Drop + Money

## Modules (api)

| Module  | Owns                                                                            | Notes                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai`    | `ai_usage` ledger                                                               | The only place that calls a model (AGENTS.md). Routes per task (`drop.understand`, `today.parse`), OpenRouter provider + fake for tests, JSON-schema output with repair, $1/day cap (D19), every call recorded with tokens and cost. ADR-0010. |
| `files` | `files` table + object store (local dir or R2)                                  | Each object encrypted with its own data key (libsodium secretstream), data key wrapped with `FILES_MASTER_KEY`; owner-scoped download. ADR-0011.                                                                                               |
| `drop`  | `drop.item` (synced)                                                            | Created by devices; the server's worker proposes (`proposal`), the device confirms by creating the target and marking the item done.                                                                                                           |
| `money` | `money.account`, `money.transaction`, `money.category`, `money.budget` (synced) | Amounts in minor units (paise). `dedupeKey` unique per owner. Month story and subscriptions are computed by `packages/money-core`.                                                                                                             |

## Reading bank and UPI messages (ADR-0012)

`packages/money-parse` (TS) and `apps/mobile/lib/money/parse.dart` (Dart) implement the same rules against one
fixture file (`packages/money-parse/fixtures/messages.json`, fake but realistic messages). Android reads
**notifications** (NotificationListenerService) from SMS apps and from GPay/PhonePe/Paytm — not `READ_SMS`, which
Play allows only for default SMS apps. Messages are parsed on the phone; only the parsed transaction syncs (AC5).
`dedupeKey` = UPI/RRN reference when present, else a hash of (account last 4, amount, minute). A bank SMS and an app
notification for the same UPI payment share the reference → one entry (AC2).

## Drop pipeline

Device creates `drop.item` (text / transcript / file id / link) → `sync.applied` → queue `drop.understand` → `ai`
with the person's recent corrections as examples (data, never instructions) → JSON proposal
`{kind: task|event|expense|note, fields, why}` written back with the server's clock → device shows a card →
Confirm creates the target entity through sync and marks the item done (`resultRef`); Change edits the fields first
(the difference is saved as a correction). Budget reached → item stays `waiting`, retried the next day.

## Clients

- **Web**: Drop page + Drop in the command bar (paste images, files); Money page (month, categories, budgets,
  list, add, edit, CSV import, subscriptions, month story); Settings → Money (categories, accounts, budgets).
- **Android**: Drop from the Orb and the share sheet, voice by on-device recognition; Money tab with the "new" strip,
  capture switch (notification access) and the same views.
- **Extension**: popup field that adds to Today or Drop.

## Milestones

| M   | Ships                                                                                           |
| --- | ----------------------------------------------------------------------------------------------- |
| M1  | `ai` + `files` modules; Today parser AI fallback; extension quick add                           |
| M2  | Money: parsers + fixtures (TS + Dart), entities, web + Android UI, Android capture, CSV import  |
| M3  | Drop: items, understanding, confirm/correct on web + Android (+ share sheet, voice) + extension |
