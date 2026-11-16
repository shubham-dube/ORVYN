# ADR-0003: Authentication

- Status: Accepted (D12) · Date: 2026-11-16

## Decision
Passkeys (WebAuthn, `@simplewebauthn/server`), Google OAuth, email one-time codes. Own auth module in Nest
(no third-party auth service: fewer moving parts, no per-user fees). Short-lived access JWT + rotating refresh
tokens with reuse detection; per-device sessions; new-device alerts.

## Consequences
We own security-critical code, so it gets the most tests (including token reuse, revocation, rate limits).
