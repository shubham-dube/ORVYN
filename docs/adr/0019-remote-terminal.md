# ADR-0019: Running commands on the PC from elsewhere

- Status: Proposed (built with spec 0021 step 3)
- Date: 2026-11-25
- Related: ADR-0004, spec 0021

## Context

The founder wants a full terminal on their PC from their phone. Relayed plainly, anyone who takes over the ORVYN account,
its server, its database or Redis would own the PC.

## Decision

- **End to end.** The PC makes a random 32-byte key per paired device and shows it once, on its own screen. Messages are
  XChaCha20-Poly1305 (libsodium in the browser, RustCrypto `chacha20poly1305` on the PC) with the session, the direction
  and a counter as associated data; a counter that is not the next one is refused.
- The server only forwards opaque messages between two devices of the same person, behind a `pc` module switch, with size
  and rate limits. It stores none of them.
- The PC is the only place to switch it on, set the PIN, pair, list and remove devices.
- The browser keeps its key in IndexedDB, wrapped by the PIN (Argon2id). A wrong PIN is also counted on the PC.

## Consequences

Losing the phone means removing it at the PC. Clearing the browser's data means pairing again. A web app served by a
compromised server could steal the key when the PIN is typed: the same limit as the web Vault. The native Android app
avoids it and is the stronger place to use this from.
