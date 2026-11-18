# Tasks 0003: Drop + Money

## M1 — AI and files

- [x] api `ai` module: providers, routes, ledger, $1/day cap, tests (ADR-0010)
- [x] api `files` module: encrypted objects, owner-scoped, local + S3 drivers, tests (ADR-0011)
- [x] Today parser AI fallback (rules first; AI only when words look like an unread date/time)
- [x] extension popup: add to Today

## M2 — Money

- [x] packages/money-parse + fixtures (AC1), Dart port against the same fixtures
- [x] api `money` entities, dedupe, owner tests (AC2, AC6)
- [x] web Money page, CSV import, budgets, subscriptions, month story; e2e
- [x] Android Money tab, notification capture (AC5), widget tests

## M3 — Drop

- [x] api `drop` entity + understand job + corrections (AC3, AC4)
- [x] web Drop page + command bar; e2e with the fake model
- [x] Android Drop (Orb, share sheet, voice); tests
- [x] extension popup: add to Drop

## Notes

- Voice: words come from the phone's or the browser's own speech recognition; audio never reaches ORVYN's server.
- Android capture reads notifications (ADR-0012), so a bank SMS is seen only if the SMS app shows a notification
  for it; messages from before notification access was turned on aren't read (import a statement for those).
- Web/iPhone: subscriptions and "what changed" are on the web page; Android shows the month, budgets and the list.
- Needs from the owner before AI works for real: an OpenRouter key (`OPENROUTER_API_KEY`, D13). Without one, Drop
  items say so and offer "make it a task / keep as a note"; Money capture, typed entries and statements need no AI.
