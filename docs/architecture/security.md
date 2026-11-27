# Security & privacy

## Threat model (what we defend against)

| Threat                                   | Defence                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stolen phone / laptop                    | device sessions revocable; app lock (biometric/PIN) optional per app, required for Vault; vault keys only in OS keystore                                                                   |
| Stolen password / phishing               | passkeys preferred; no SMS codes; new-device sign-in notifies all other devices                                                                                                            |
| Server or database breach                | Vault is end-to-end encrypted (attacker gets ciphertext); chat is encrypted at rest (ADR-0016). Other data encrypted at rest (disk + per-file keys for objects); secrets in env, not in DB |
| Malicious backup access                  | backups encrypted with a key that is not stored on the server                                                                                                                              |
| A friend reading another friend's data   | every query scoped by `owner_id`; tests per module; sharing only through explicit share objects                                                                                            |
| A friend using hidden features           | entitlements checked on the server for every request and websocket topic                                                                                                                   |
| Prompt injection via documents/web pages | content is passed to the AI as data; the AI cannot act without the person's confirmation on anything consequential; vault is never in AI context                                           |
| Over-collection                          | Money's SMS parsing runs on the phone; only parsed transactions are uploaded unless the person opts in                                                                                     |

## Sign-in (ADR-0003)

- **Passkeys (WebAuthn)** on web, Android and Windows; **Google sign-in**; **email one-time code** as fallback.
- Short-lived access token (15 min, in memory) + rotating refresh token (httpOnly cookie on web; OS secure
  storage on mobile/desktop). Refresh-token reuse ⇒ the whole session family is revoked.
- Devices list with last seen, remote sign-out. Admin can disable an account.

## Vault — zero-knowledge (ADR-0004)

- Library: **libsodium** (via `libsodium-wrappers-sumo` on web/extension/desktop); in Flutter the pure-Dart
  `cryptography` package with the same algorithms, checked against shared test vectors (D24, ADR-0014). On the PC:
  RustCrypto `chacha20poly1305` and `argon2`, for the terminal only, with the same vectors (ADR-0019).
- Chat: kept on the server and encrypted at rest with a key derived from `FILES_MASTER_KEY` (ADR-0016). Older
  messages were sealed to devices with X25519 + BLAKE2b and signed with Ed25519 (ADR-0014). They are carried over
  only after their signature is checked.
  No custom primitives.
- **Vault passphrase** (separate from the account login) → **Argon2id** (moderate profile, tuned per device)
  → key-encryption key (KEK). A random 256-bit **vault key** encrypts items with **XChaCha20-Poly1305**; the
  vault key is stored on the server only _wrapped_ by the KEK and, separately, by the **recovery key** (shown
  once as a printable kit).
- Each item: random nonce, authenticated encryption, item type and minimal metadata also encrypted. The server
  sees: item ids, sizes, timestamps — nothing else.
- Unlock: passphrase, or biometrics on a device that previously unlocked (vault key wrapped by a key in Android
  Keystore / Windows Hello / WebAuthn PRF where available). Auto-lock after inactivity; re-auth on every open
  (configurable short grace period).
- Clipboard auto-clear; `FLAG_SECURE` on vault screens (no screenshots); no vault content in notifications.
- Lost passphrase **and** lost recovery kit ⇒ data is unrecoverable. This is stated plainly at setup.

## Connected calendars (spec 0002 M5)

- Google OAuth (authorization code + PKCE, one-time `state` tied to the person who started), offline access with
  the narrowest calendar scopes (`calendar.events`, `calendar.calendarlist.readonly`).
- Refresh and access tokens are stored only encrypted with **libsodium secretbox** (random nonce per value, key
  `CALENDAR_TOKEN_KEY` from the environment, never in the database). They never reach clients, logs or analytics.
- Push-channel webhooks are accepted only with an HMAC channel token; Google content (titles, notes, locations) is
  data, never instructions.
- Disconnecting revokes the token at Google and removes that account's calendars and events from every device.

## Library & everything else

- Encrypted at rest: database volume encrypted; every uploaded object encrypted with its own data key
  (envelope encryption, master key from the server's env/KMS, not stored in the DB). AI-readable by decision D4.

## Chat

- Encrypted at rest on the server, not end-to-end (ADR-0016, which supersedes the end-to-end plan of ADR-0014).
  The key lives in the server's environment, never in the database, so a copied database alone reveals nothing. The
  running server can read messages (for previews, replies from a notification and search); chat is never sent to
  the AI.

## Operational

- TLS everywhere (Cloudflare in front, strict mode to origin). Security headers, CSP on web.
- Rate limits on auth and AI endpoints. Audit log for admin actions, sign-ins, vault unlocks (event only).
- Dependency and secret scanning in CI (gitleaks, `pnpm audit`, Dependabot).
- Encrypted nightly backups + weekly restore test (automated).
