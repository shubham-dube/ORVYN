# ADR-0015: Split groups are shared records, readable by the server

- Status: Accepted
- Date: 2026-11-19
- Related: spec 0011 part B, ADR-0013 (links), architecture rule 5 (a person's data is theirs alone)

## Context

Shared expenses need the server to compute balances, settle-up plans and notifications, and must include people who
are not on ORVYN.

## Decision

- A Split group is an explicit **sharing object**: its members (ORVYN people and guests) can see the group's
  expenses, settlements and balances; nobody else can. Every query checks membership.
- Split data is **not** end-to-end encrypted (it is money arithmetic the server does), unlike Chat. When Split
  activity appears inside a group chat it is a system line, marked as not encrypted.
- Guests reach a group through a private read-only link: a random token whose SHA-256 hash is stored, with an expiry
  and revocation, rate-limited — the same pattern as ADR-0013.
- Amounts are integers in paise; splits round to the paisa with the remainder assigned deterministically, so totals
  always add up exactly.

## Consequences

- Balances, plans and reminders work for everyone, including guests, at the cost of the server seeing the amounts.
