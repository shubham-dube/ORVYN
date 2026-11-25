# ADR-0018: The activity record

- Status: Accepted
- Date: 2026-11-25
- Related: ADR-0011, ADR-0016, specs 0020 and 0021

## Decision

- Devices send **spans**: start, end, where (app, host, path, title) and how much (counts of keys, clicks, scrolls).
  **Never which keys.** Times stay in plain columns for queries; everything else is one sealed blob
  (`crypto_secretbox`, a per-person key derived from `FILES_MASTER_KEY`).
- It belongs to the `activity` module and to one person. There is no admin view and no sharing.
- Pages' text (Recall) never leaves the device.
- The AI sees a day only when its story is asked for: place names, what was open and durations.
- The person can delete any range. Spans are idempotent by id.
- One set of rules (`packages/activity`) turns spans into a day, so web, extension and Windows agree.

## Consequences

The server can technically read the record (it merges days and writes the story), as with chat (ADR-0016).
