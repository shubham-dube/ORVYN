# ADR-0019: Running commands on the PC from elsewhere

- Status: Accepted 2026-11-25 (built with spec 0021 step 3)
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
- The PIN is checked only on the PC (Argon2id), inside the encrypted session; the PC writes each try down before it
  checks it and locks after five. It is never kept on the phone or in the browser.
- The browser keeps its key in IndexedDB under an AES-GCM key that cannot be read out (Web Crypto); Android in its
  Keystore-backed storage.
- A session has a fresh random half from each side, so a recording replayed later opens nothing. The server only names
  which device a message came from.

Changed while building (2026-11-26): the key was to be wrapped by the PIN. Whoever copied it could then have tried every
PIN at home; now each try must reach the PC, which allows five.

## Consequences

Losing the phone means removing it at the PC. Clearing the browser's data means pairing again. A web app served by a
compromised server could use the key and steal the PIN as it is typed: the same limit as the web Vault. The native Android app
avoids it and is the stronger place to use this from.
