# ADR-0001: Docs first, one niche at a time

- Status: Accepted · Date: 2026-11-16

## Context

ORVYN spans many features and five clients. Starting many at once produces many half-features.

## Decision

Every feature starts with a spec (`docs/specs/NNNN-*`) agreed with the founder, then is built end to end
(api → web → mobile → notifications → tests → docs) before the next starts. Decisions are recorded here.

## Consequences

Slower to show breadth, much faster to reach daily use. Specs keep the AI agents and humans aligned.
