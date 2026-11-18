# ADR-0012: Money capture from notifications, parsed on the phone

- Status: Accepted
- Date: 2026-11-18
- Related: D18, D20, spec 0003 AC1/AC2/AC5

## Context

Bank SMS and UPI app notifications are the most reliable record of spending in India. Google Play allows the
`READ_SMS` permission only to default SMS apps, and raw messages are sensitive.

## Options

- `READ_SMS` + an SMS broadcast receiver (rejected by Play for this kind of app).
- **Notification access** (`NotificationListenerService`), granted by the person in Android settings: sees the
  SMS app's notification for each bank SMS and the UPI apps' own notifications.
- Bank aggregation APIs (Account Aggregator) — needs a licensed partner; later, maybe.

## Decision

Notification access. A Kotlin listener keeps only notifications from SMS apps and the payment apps (D18), queues
their text on the device, and the app parses them with the same rules as `packages/money-parse` (shared fixtures).
Only the parsed transaction syncs; the queue is cleared after parsing (AC5). Duplicates across a bank SMS and an
app notification share the UPI/RRN reference (`dedupeKey`, unique per person). Transactions are added directly
with a "new" mark and one-tap fix or delete (D20). Web/iPhone get CSV import, receipts and typed entries.
