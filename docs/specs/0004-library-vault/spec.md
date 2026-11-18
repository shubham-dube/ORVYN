# Spec 0004: Library + Vault

Status: Approved scope (roadmap step 4; D4, D24, D26) · Phase 4 · Modules: `library` (amber), `vault` (violet)

## Problem

Documents (PAN card, rent agreement, insurance) and secrets (passwords, card numbers, recovery codes) live in
photos, mail and notes. Library finds and organises documents; Vault keeps secrets so that even the server can't read
them.

## User stories

- I drop a photo or PDF of my insurance; it gets a title, tags and a summary; its expiry date becomes a reminder; an
  amount due becomes a suggestion in Money. "My PAN card" finds it in one step.
- I write notes and keep them with documents. I can search everything I've kept in plain words.
- I set a Vault passphrase once and get a recovery key to print. I keep passwords, cards, IDs, API keys, recovery
  codes and secure notes there; it locks itself; every time I open it I confirm it's me.
- The server, the AI, the logs and the backups never see a Vault item in readable form.

## Scope

**In:** Library documents (files and notes) with AI organise (title, category, tags, summary, key dates, amounts),
search (full text + tags), expiry reminders via the notify pipeline (all channels, D22), "to Money" suggestion for
amounts due, view/download of the original, web + Android; Vault items (login, card, ID, API key, recovery codes,
secure note) with client-side encryption, setup, unlock, lock (auto-lock), change passphrase, recovery with the
recovery key, copy with auto-clear, generate password, web + Android; vault attachments (small files encrypted on
the device).
**Out (later):** sharing documents or vault items with friends, browser autofill, biometrics-unlock on Windows, bulk
import from other password managers (CSV import is included for common formats).

## Acceptance criteria

- [ ] AC1 Library: a dropped image/PDF/text gets title, category, tags, summary and key dates; expiry dates create
      reminders that fire; search finds "pan card" in one query; everything is owner-scoped (tests).
- [ ] AC2 Vault: items are encrypted before leaving the device; the server stores only ciphertext and sizes; a test
      reads the database and finds no plaintext; the AI/assistant has no vault tool.
- [ ] AC3 Passphrase never leaves the device; wrong passphrase fails; recovery key restores access and sets a new
      passphrase; changing the passphrase re-wraps the key without re-encrypting items.
- [ ] AC4 Locking clears keys from memory; auto-lock after inactivity; re-auth to open.
- [ ] AC5 Web and Android produce and read the same ciphertext (shared test vectors).
- [ ] AC6 Clipboard auto-clear; no vault content in notifications, logs or crash reports.

## Open questions

- Biometric unlock on Android (keystore-wrapped vault key): after the core is in.
