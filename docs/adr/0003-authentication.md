# ADR-0003: Authentication

- Status: Accepted (D12) · Date: 2026-11-16

## Decision

Passkeys (WebAuthn, `@simplewebauthn/server`), Google OAuth, email one-time codes. Own auth module in Nest
(no third-party auth service: fewer moving parts, no per-user fees). Short-lived access JWT + rotating refresh
tokens with reuse detection; per-device sessions; new-device alerts.

## Consequences

We own security-critical code, so it gets the most tests (including token reuse, revocation, rate limits).

## Addendum (2026-11-16): connecting the desktop app and the browser extension

Apps that can't show our sign-in screens well connect through the web app (OAuth-style, RFC 8252 + PKCE): the app
opens `/connect` with a PKCE challenge and its redirect (loopback `http://127.0.0.1:<port>/…` for desktop,
`https://<extension-id>.chromiumapp.org/` for allowlisted extension ids); the signed-in person presses Connect; the
API returns a random single-use code (2 minutes, stored hashed, burned on first attempt) bound to the challenge,
redirect and app type; the app redeems it with its verifier for its own device session (refresh token in the OS
keychain / extension storage). Any other redirect is refused, so there is no open redirect and no code leakage.
