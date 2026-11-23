# ADR-0016: Chat kept on the server, encrypted at rest

- Status: Accepted
- Date: 2026-11-23
- Supersedes: ADR-0014 for new messages (ADR-0014 still describes how old messages were sealed and how they are
  carried over)
- Related: ADR-0011 (files at rest), spec 0015 C, D-0015-1

## Context

ADR-0014 sealed each message to the devices that existed when it was sent. A new phone or browser therefore starts
with an empty history, and pushes can't say what was written. The founder chose: "I don't want to lose my chat when
I change my device… encryption is second priority." The group is small (5–50 friends, D9) and run by the founder.

## Decision

- **New messages are stored server-side**, with the content (text, attachments, share) as one JSON object sealed
  with libsodium `crypto_secretbox` (XSalsa20-Poly1305). The key is derived from `FILES_MASTER_KEY` with
  `crypto_generichash` and a chat-specific label. The key lives in the environment, never in the database. A copied
  database alone reveals nothing (ADR-0011's model).
- **Attachments** are uploaded as ordinary files (purpose `chat-file`), encrypted at rest per file (ADR-0011).
  Members of the conversation can download them.
- **The server can read chat content.** It uses this for pushes with previews, Reply from a notification, and
  search. Nothing is sent to the AI: chat has no AI tool, and rule 4 stands.
- **Carrying old messages over:** a device holding a working sealed key sends the server the unsealed message key
  `K`. The server verifies the sender device's Ed25519 signature over the ciphertext, decrypts with `K`
  (`openMessageWithKey` in `@orvyn/vault-crypto`) and stores the result as a v2 message. Encrypted attachments are
  decrypted with the key inside the message and re-stored as ordinary files. Then the ciphertext and per-device keys
  are deleted. A wrong key or a bad signature changes nothing.
- The v1 send path stays, so installed old apps keep working until they update.

## Consequences

- History, pushes with text, inline replies and search work on every device.
- Someone with both the database and the environment, or with control of the running server, can read chats. This
  is the same trust placed in Library documents (D4).
- The Vault is untouched: it stays zero-knowledge (ADR-0004, rule 1).
- An end-to-end "secret chat" could return later as a per-conversation option (spec 0015 open question).
