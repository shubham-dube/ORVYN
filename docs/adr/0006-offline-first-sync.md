# ADR-0006: Offline-first sync with a change log

- Status: Accepted · Date: 2026-11-16 · Related: data-and-sync.md

## Decision

Client-generated UUIDv7 ids, server change log with global sequence, cursor-based pull, idempotent batched
push, field-level LWW with hybrid logical clocks and per-module merge overrides; websocket "changed" pings.
PowerSync/ElectricSQL considered and deferred (extra service, licensing).

## Consequences

We build and test a small sync engine once (in `sync` + client libraries for Dart and TS) and every module
reuses it.
