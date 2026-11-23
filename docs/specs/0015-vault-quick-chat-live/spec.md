# 0015 — Vault in a second, chat that follows you

Status: **Delivered** (API, web, Android), 2026-11-23. Decisions: D-0015-1…7. ADR-0016 (chat kept on the server, encrypted at rest;
supersedes ADR-0014 for new messages).

## Why

- **Vault:** using the Vault takes too many steps. You open it, type a long passphrase, search, open the item, tap
  show, then copy. Adding an item means choosing a kind from a row of chips and filling a long form. The "New" sheet
  looks plain next to the rest of ORVYN.
- **A new phone should bring everything.** Almost everything already lives on the server. The exception is **chat**:
  each message was sealed to the devices that existed when it was sent (ADR-0014), so a new phone or browser started
  empty. People want their chats back on any device more than they want the server unable to read them.
- **Chat:** it should feel like a real messaging app. That means instant sending, live delivery, ticks, replies,
  reactions, forwarding, pinning, search, photos inline and notifications you can answer.

## A. Vault — faster in, faster out

1. **Unlock with fingerprint (Android).**
   - After a passphrase unlock, "Use fingerprint next time" keeps the vault key in this phone's keystore-backed
     secure storage.
   - The key is released only after the system's fingerprint, face or screen-lock prompt.
   - It never reaches the server, so rule 1 still holds.
   - It is forgotten on "Forget fingerprint", on recovery, and on sign-out.
   - The web keeps the passphrase for now (passkey unlock later).
2. **Quick find.**
   - The open Vault leads with search.
   - Every result has its copy buttons right on the row: username, password, card number, key, or the live
     one-time code. Nothing needs to be opened first.
   - The items used most recently come first. Their ids are kept on this device only.
   - A copied secret clears from the clipboard after 30 seconds.
3. **From anywhere.**
   - **Android:** long-press the ORVYN icon for "Find in Vault" or "Add to Vault". Either one opens straight there,
     asking for the fingerprint.
   - **Web:** Ctrl/⌘-K searches the Vault as you type. When the Vault is locked, the bar asks for the passphrase in
     place. Enter copies the password.
4. **Smart add.** "Paste anything" understands what was pasted, on the device, never by the AI:
   - a card number (checked with Luhn), with expiry, CVV and name;
   - an email or username with a password;
   - an `otpauth://` link;
   - API keys (`sk-…`, `ghp_…`, `AKIA…`, `xoxb-…`);
   - a block of recovery codes;
   - a site name.
     The form fills itself; you check it and save.
5. **Live one-time codes** (TOTP, RFC 6238) for logins with a secret, with a countdown. Tapping a code copies it.
6. **The item sheet, redesigned.**
   - Kinds are a grid of coloured icons.
   - Each item gets a monogram from its title or site.
   - Fields sit in one card, each with show, generate and copy.
   - Passwords get a strength meter and a generator (length, symbols).
   - Viewing an item shows a header in the kind's colour, the fields as rows, the code with its countdown, and when
     it was last changed.
7. **Notifications:** none carry Vault content, by rule (spec 0004 AC6).

## B. A new device brings everything

Everything a person makes is stored on the server and arrives on a new device at the first sync:

- tasks, money, library, IPO and split data;
- settings, and the Vault (sealed; it opens with the passphrase);
- now also **chat** (part C).

These stay per device by design:

- theme;
- app lock;
- fingerprint unlock for the Vault;
- the Vault's auto-lock time.

## C. Chat that follows you (ADR-0016)

### Storage

Messages are kept on the server, **encrypted at rest** with a server-held key, the same way files are
(ADR-0011). Every device of the person sees the whole history.

**Old end-to-end messages are carried over:** the first time a device that can still read an old message opens
the conversation, it hands the server that message's key. The server checks the sender's signature, then stores
the message like any other, including re-storing its photo or file. Messages that no remaining device can read
stay marked as such.

### Messages

| What           | How                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send           | Shows at once ("sending" clock), confirmed by the server, retried when back online; a failed one has **Retry**. The phone keeps unsent messages across restarts. |
| Ticks          | ✓ sent · ✓✓ delivered (reached their app) · ✓✓ in colour = read by everyone. A group shows who read it in Info.                                                  |
| Live           | New messages, edits, reactions and deletions arrive over the socket with the message itself, with no reload. Typing… and **online / last seen** in the header.   |
| Reply          | Swipe right (Android) or the reply button (web). A tapped quote jumps to the original.                                                                           |
| React          | Long-press (or hover) for 👍 ❤️ 😂 😮 😢 🙏 and more. One reaction per person per message; tapping yours removes it.                                             |
| Edit           | Your own text, shown as "edited".                                                                                                                                |
| Delete         | For everyone (your own) or **for me** (any).                                                                                                                     |
| Forward        | To any of your chats, marked "Forwarded"; photos and files go with it.                                                                                           |
| Copy, pin      | Copy text; pin one message to the top of the chat (system line "Asha pinned a message").                                                                         |
| Photos & files | Photos show inline (tap for full screen); other files as cards with name, size and type. Several at once, with a caption.                                        |
| Search         | Inside a chat: matching messages with the words highlighted; tap to jump.                                                                                        |
| List           | Last message preview, time, unread count, typing…, online dot, pinned chats on top, muted icon.                                                                  |
| Thread         | Grouped bubbles, day separators, an "N new messages" line, jump-to-latest with a count, links you can tap.                                                       |

### Notifications

- A push says who wrote and what: in a group, "Asha: see you at 8". It shows up to the last four unread lines,
  updates in place, and has **Reply** (typed right in the shade) and **Mark as read**.
- Reading the chat on any device clears it everywhere.
- Muted chats don't ping.

## API (summary)

- `POST /chat/conversations/:id/messages` with `{id, text?, replyTo?, attachments?, share?, forwardOf?}`. The v1
  sealed form is still accepted from old app versions.
- `PATCH /chat/messages/:id` edits.
- `PUT /chat/messages/:id/reaction` sets or removes a reaction.
- `DELETE /chat/messages/:id` deletes for everyone; `POST /chat/messages/:id/hide` deletes for me.
- `PUT /chat/conversations/:id/pin` pins a message; `PUT /chat/conversations/:id/pinned` pins the chat.
- `POST /chat/conversations/:id/delivered`.
- `GET /chat/conversations/:id/search?q=`.
- `POST /chat/conversations/:id/carry` with `{items: [{id, key}]}` for old messages.
- Socket messages:
  - `chat.message` carries the message view;
  - `chat.delivered`;
  - `chat.presence`.

## Data

- `chat_messages`: `v` (1 sealed, 2 at rest), `body` (sealed at rest), `reply_to_id`, `forward`, `edited_at`,
  `files_owner_id`.
- `chat_reactions` (message, person, emoji).
- `chat_hidden` (message, person).
- `chat_members`: `last_delivered_at`, `pinned`.
- `chat_conversations`: `pinned_message_id`.
- Presence lives in Redis.
- Migration `0027_chat_live.sql`.

## Acceptance criteria

- [x] AC1 Vault: fingerprint unlock opens without the passphrase; the key is never sent anywhere; "Forget" removes
      it (Android tests).
- [x] AC2 Vault quick find copies a password from the search result; codes match RFC 6238 test vectors (web and
      Android); smart add recognises cards, logins, keys, codes and otpauth links (unit tests).
- [x] AC3 Chat history appears on a brand-new device; the stored rows hold no readable text (at rest); a non-member
      gets nothing (API tests).
- [x] AC4 An old end-to-end message is carried over only with a key that opens it and a valid signature; a wrong
      key changes nothing (API test).
- [x] AC5 Replies, reactions, edits, delete for everyone and for me, forward, pin, search, delivered/read and
      presence work (API tests); web and Android screens (tests).
- [x] AC6 A chat push names the sender and shows the text; Reply from the notification sends the message and
      clears it; muted chats don't ping (API tests).

## Open questions

- Voice notes: recording exists on both apps, but Android has no audio player yet.
- Unlocking the Vault with a passkey on the web (WebAuthn PRF).
- Should chat ever offer an end-to-end "secret chat" again, per conversation?
