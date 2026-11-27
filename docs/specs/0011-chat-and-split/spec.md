# Spec 0011: Chat, and Split (shared expenses)

Status: Delivered 2026-11-19 (API, web, Android; guide in docs/guides/chat-and-split.md) · Roadmap (D-0008-1, D-0008-2) · Modules: `chat`, `split`

## Problem

Friends on ORVYN still talk on other apps, and every trip or party ends in a messy "who paid what" thread. Chat should
be private by design (the server cannot read it), and shared expenses should be first-class: anyone can pay, many can
contribute to one bill, it can be split any way, and at the end ORVYN says exactly **who gives whom how much**.

## Part A — Chat (end-to-end encrypted, ADR-0014)

**Conversations:** one-to-one and groups (up to 50) between ORVYN people who have Chat. A group has a name, an admin
(who made it) who can add, remove and rename; anyone can leave.

**Messages:** text, **replies** (quoting a message), **reactions**, **edits** (marked "edited"), **delete for
everyone** (own messages), **photos and files** (encrypted on the device before upload), and **shares** of ORVYN things
— a task, an IPO, a Library document, a Split group — as cards that open in the right place for whoever has access.
Read receipts (✓ sent, ✓✓ read by …), typing indicators, unread counts, per-conversation **mute**.

**Privacy:** each device has its own keys; every message is encrypted on the sender's device with a fresh key that is
sealed separately to every device of every member (including the sender's other devices) and signed by the sending
device. The server stores and relays ciphertext; it sees who talks to whom and when, never what. Push notifications
say only "New message from Asha". A device added later cannot read earlier messages (shown plainly). Each contact's
device fingerprints are visible for checking in person. System lines (someone added, a Split expense) are not
encrypted and are marked so.

## Part B — Split (shared expenses, ADR-0015)

**Groups** ("Goa trip", "Diwali party", "Flat"): a name and kind (trip, party, home, other), members who are either
ORVYN people (with Split) or **guests** (just a name and a phone number). A group can have its own chat.

**Expenses:**

- **Who paid** — one person, or **several contributions** ("Asha ₹2,000 + Ravi ₹1,000 for the hotel").
- **For whom, how** — split **equally** among chosen members, by **exact amounts**, by **percentages**, or by
  **shares** (2 : 1 : 1 for a couple and two singles). Rounding is to the paisa; leftover paise go to the first members
  so the parts always add up.
- Title, date, category, note, a receipt photo. Anyone in the group can add one; the person who added it or the admin
  can change or remove it; every change shows in the group's activity.

**Balances and settling up:**

- Each member's balance = what they paid − their share of everything + what they paid others back − what they were
  paid back. Positive: they should get money; negative: they owe.
- **Settle up** shows the **fewest transfers** that clear everyone ("Ravi → Asha ₹1,250; Mia → Asha ₹300"), with UPI
  IDs where known. Recording a payment ("Ravi paid Asha ₹1,250 by UPI") moves the balances.
- Totals: the group's spend, what each person consumed, by category.
- **The list of groups** comes a page at a time (20, newest activity first, "Show more"); what I get back and what I
  owe are summed over all my groups on the server. **Who made a group can delete it** for everyone, after a
  confirmation that says when balances aren't settled; its expenses, payments, links and activity go with it, and
  the others get a "group deleted" notification. Others can archive it for themselves.

**Reaching people:** ORVYN members get a notification for each expense that involves them ("Asha added Dinner
₹2,400 · your share ₹600") and can be **reminded** with one tap. Guests get a private read-only link (like the IPO Pool,
ADR-0013) showing the group, its expenses and what they owe or are owed; a WhatsApp message with the link and their
amount is one tap. A plain-text summary can be copied for any chat.

**Money:** "Add my share to Money" files your share of an expense (or a whole trip's total) as an expense in Money,
only when you tap.

## API (summary)

Chat: `/chat/devices` (register keys), `/chat/keys` (members' device keys), `/chat/conversations` (list, create,
members, rename, leave, mute, read, typing), `/chat/conversations/:id/messages` (send with per-device sealed keys,
page; each device gets only its own sealed key), `DELETE /chat/messages/:id`, `/chat/files` (encrypted upload,
download for members).
Split: `/split/groups` (`?cursor=&limit=`, `{items, next, getMinor, oweMinor}`; `DELETE /split/groups/:id` for the admin) (+ members, guests, links), `/split/groups/:id/expenses`, `/split/groups/:id/settlements`,
`/split/groups/:id/balances` (balances, settle-up plan, totals), `/split/groups/:id/remind`, public `/split-links/:token`.

## Acceptance criteria

- [x] AC1 Messages are encrypted on the device; the server stores only ciphertext and per-device sealed keys
      (test: the stored rows contain no plaintext; a non-member's device gets nothing).
- [x] AC2 Web and Android encrypt and decrypt each other's messages (shared test vectors).
- [x] AC3 Replies, reactions, edits, deletes, files, shares, receipts, typing, mute work on web and Android.
- [x] AC4 Split math: contributions, equal/exact/percent/shares splits with exact paise, balances, and the fewest
      transfers (unit tests with worked examples).
- [x] AC5 Members see only groups they belong to; guests see only their group through a link that can be revoked.
- [x] AC6 Notifications: new expense with your share, settlement recorded, reminders; chat pushes carry no content.
- [x] AC7 Web and Android screens for both, with tests.

## Open questions

- Forward secrecy (MLS) later (D-0008-1).
- Should guests be able to add expenses through their link? Read-only for now.
