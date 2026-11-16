# Data model & sync

## Rules for every table
- `id` (UUIDv7 — time-ordered, generated on the client so offline creation works), `owner_id`,
  `created_at`, `updated_at`, `deleted_at` (soft delete for synced data), `version` (server sequence).
- Money amounts in integer minor units + currency code. Times in UTC + the IANA time zone they belong to.

## Offline-first sync (ADR-0006)
- Every synced module writes through the `sync` module, which appends to a **change log** with a global,
  monotonically increasing `seq`.
- **Pull:** client asks `changes since <cursor>` per scope (owner + modules they have access to); gets rows +
  tombstones and a new cursor.
- **Push:** client sends a batch of mutations, each with a client-generated id (idempotent), the base version
  it edited, and changed fields only.
- **Conflicts:** field-level last-writer-wins by hybrid logical clock, except where a module defines a
  smarter merge (e.g. checklist items merge, money never auto-merges amounts — conflict is surfaced).
- **Realtime:** after a commit the server publishes `scope changed (seq)` on the websocket; open clients pull.
  Push notifications wake the phone for things that matter (reminders, messages).
- Local stores: Drift/SQLite (Flutter), IndexedDB (web/extension). Clients render from the local store, so
  the UI is instant and works offline.

Considered: PowerSync and ElectricSQL (both capable; licences and an extra service to run). A small,
well-tested change-log protocol fits 5–50 users and keeps one less moving part. Revisit if sync becomes the
bottleneck.

## Search
- Postgres full-text search for exact things; **pgvector** embeddings for meaning ("insurance that expires this
  year"). Hybrid ranking. Vault is never indexed on the server.
