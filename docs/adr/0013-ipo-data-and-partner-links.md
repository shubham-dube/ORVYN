# ADR-0013: IPO market data and partner links

- Status: Accepted
- Date: 2026-11-19
- Related: spec 0010, D-0010-1..3

## Context

The IPO desk needs public market data (calendar, GMP, subscription) that is the same for everyone, and the IPO Pool
needs people who are not ORVYN users (the founder's partners) to confirm what they did.

## Decisions

1. **Market data is a reference table without an owner.** `ipo_issues` and `ipo_snapshots` hold public data shared
   by every user; they carry no personal data. Everything personal (stars, settings, alerts, the Pool) has
   `owner_id` and is scoped as usual. This is the one exception to "every table has `owner_id`".
2. **A pluggable feed.** `IpoFeed` with one implementation per provider (first: IPO Guru, key in `IPO_FEED_KEY`) and
   typed-in figures as a provider of their own. Provider data is shown with its source, time and the credit link its
   terms require; it is not republished as a feed. GMP is always labelled unofficial.
3. **Partner links are sharing objects, not accounts.** A link is a random 32-byte token; only its SHA-256 hash is
   stored, with the partner, an expiry (90 days) and a revoked flag. The page shows that partner's open applications,
   what they hold and their share — nothing about other partners or the owner's other data — and accepts only the
   status changes listed in the spec. Rate-limited; every change is audited and pings the owner.

## Consequences

- Market data can be refreshed once for everyone (cheap on a free API plan).
- A leaked link exposes one partner's IPO items until it is revoked or expires.
