# ADR-0005: One deployment, features per person

- Status: Accepted · Date: 2026-11-16 · Related: D9

## Context
The founder wants to give the app to friends "with hiding features".

## Options
1. A separate deployment per friend — expensive and painful to update.
2. **One deployment with roles and per-person feature switches (entitlements).**

## Decision
Option 2. `access` module: roles (owner/admin, member), entitlements per module (and per capability where
useful, e.g. `ai.strong_model`, `storage.quota`). Enforced in a Nest guard on every route and websocket topic,
and in sync scopes; clients hide what is not entitled. A hidden module is invisible to the friend — no menu, no
API, no notifications, no sync.

## Consequences
Every new module declares its entitlement key and gets guard + tests for "not entitled" on day one.
