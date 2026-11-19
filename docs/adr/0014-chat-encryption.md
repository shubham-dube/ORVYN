# ADR-0014: Chat encryption — per-message keys sealed to every device

- Status: Accepted
- Date: 2026-11-19
- Related: D-0008-1 (sealed boxes, libsodium; no forward secrecy yet), ADR-0004 (Vault), spec 0011 AC1/AC2

## Context

D-0008-1 chose "sealed boxes": each message encrypted for each recipient device, with libsodium. The web uses
libsodium (`libsodium-wrappers-sumo`); the Android app uses the pure-Dart `cryptography` package (as the Vault does,
D24), which has X25519, Ed25519, BLAKE2b and XChaCha20-Poly1305 but not libsodium's XSalsa20-based `crypto_box_seal`.

## Decision

The same idea as `crypto_box_seal`, built only from primitives both audited libraries provide, with shared test
vectors so the two implementations produce identical bytes:

- **Device keys:** an X25519 key pair (sealing) and an Ed25519 key pair (signing) per device, made on the device;
  private keys never leave it (web: IndexedDB; Android: the platform keystore-backed secure storage). Public keys are
  registered with the server per device.
- **Message:** a random 32-byte key `K`; content (JSON) encrypted with XChaCha20-Poly1305 (IETF), random 24-byte
  nonce, associated data `orvyn-chat-v1|<conversation>|<message id>|<sender device>`.
- **Seal `K` to a device:** an ephemeral X25519 key pair `(e, E)`; `s = X25519(e, R)`; wrapping key
  `w = BLAKE2b-256("orvyn-chat-seal-v1" ‖ s ‖ E ‖ R)`; `K` encrypted with XChaCha20-Poly1305 under `w`, random nonce,
  associated data `E ‖ R`. Stored as `E ‖ nonce ‖ ciphertext`.
- **Signature:** the sending device signs `BLAKE2b-256("orvyn-chat-sig-v1" ‖ conversation ‖ message id ‖ sender device ‖
nonce ‖ ciphertext)` with Ed25519. Receivers check it against the sender's registered device key before trusting the
  content, so the server cannot forge or move messages.
- **Files:** encrypted on the device with their own random key (XChaCha20-Poly1305); the key travels inside the
  message. The server stores opaque bytes.

## Consequences

- No forward secrecy: a stolen device key opens what that device could read (as D-0008-1 accepted). MLS later.
- A device added later cannot read history.
- The server could hand out a false device key (a person-in-the-middle); device fingerprints are shown so people can
  compare them in person. Key changes are visible.
- `security.md` lists this construction next to the Vault's.
