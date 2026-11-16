# ADR-0004: Zero-knowledge Vault

- Status: Accepted · Date: 2026-11-16 · Related: D4, security.md

## Decision

Vault items are encrypted and decrypted only on the person's devices with libsodium (Argon2id →
XChaCha20-Poly1305), vault key wrapped by passphrase-derived key and by a recovery key. The server stores
ciphertext and minimal metadata; the AI never receives vault content.

## Consequences

Server-side search, AI and recovery are impossible for vault data by design; the setup flow must make the
recovery kit unmissable. Shared test vectors keep Dart and TypeScript implementations identical.
