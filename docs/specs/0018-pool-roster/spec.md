# 0018 — The Pool as a roster: ask, track, close

Status: **In progress**, 2026-11-24. Decisions: D-0018-1…6. Builds on spec 0010 part B (the IPO Pool).

## Why

"Apply from my accounts" made me pick people and plan in one go. Real life goes person by person:

1. ask each one;
2. some say yes, some can't, some never answer;
3. money goes out;
4. they apply;
5. they approve the UPI mandate.

I need to see **everyone for an IPO in one place**, move each person along (or back), and at the end know who
applied, who approved the mandate and who forgot. Next time, I should be reminded who forgot last time. The WhatsApp
messages should be in my own words.

## A. The roster (D-0018-1)

- **Plan with my partners** on an IPO opens its **round**. A round can start empty. Every active partner appears in
  it, each with a status.
- **Statuses, in order:**

  | Status                  | Meaning                     |
  | ----------------------- | --------------------------- |
  | **To ask**              | in this IPO, not yet asked  |
  | **Asked**               | waiting for an answer       |
  | **Will apply**          | planned                     |
  | **Money sent**          | funded                      |
  | **Applied**             | the bid is in               |
  | **Mandate done**        | the UPI mandate is approved |
  | Allotted / Not allotted | the allotment result        |
  | Sold                    | the shares were sold        |
  | Settled                 | the money is settled        |

  Off the path:

  | Status              | Meaning                             |
  | ------------------- | ----------------------------------- |
  | **Can't this time** | declined                            |
  | **No reply**        | asked, never answered by the close  |
  | **Missed**          | said yes, didn't apply by the close |

- **Any status can be set from a menu,** forward or back. Each change is kept in the application's **history** (what,
  when, by whom: me or the partner through their link). **Undo** returns to the previous status. Moving back never
  touches the ledger: money stays recorded until I remove the entry.
- **Partners not in the round** show under "Not in this round". Tap one to add, or **Add everyone**. Someone added
  later starts at To ask.
- **Bulk:** select several people, then:
  - set their status;
  - **Ask on WhatsApp** in a guided queue (one tap opens each chat in turn);
  - remove them (only while nothing is recorded for them).
- **The board:** the round groups people by stage (Not asked · Asked · Will apply · Applied · Mandate done · Not
  applying), with a count on each and a progress bar for the round.

## B. History and reliability (D-0018-2)

- Each partner carries their track record across past rounds:
  - **applied N of M IPOs**;
  - **missed K**;
  - the last IPO they missed.
- In a new round, someone who missed last time shows **"Missed Matangi Rubber last time"**. The **Ask** message
  can add a gentle reminder line.

## C. Closing summary (D-0018-3)

- When bidding closes (5 pm India time on the close day) the round **closes itself**:
  - **Will apply** and **Money sent** become **Missed**;
  - **Asked** becomes **No reply**;
  - **Applied** without the mandate stays Applied, flagged "mandate pending".
- **One notification:** "Mega Power closed: 6 applied · 5 mandates · 2 missed (Ravi, Amit)". The round shows the
  same summary as a card with names.
- **The last-day nudge** (10 am) counts everyone not yet applied, plus mandates still pending.

## D. WhatsApp in my words (D-0018-4)

- **Templates, one per moment:**
  - **Ask:** "Will you apply?";
  - **Apply now:** lots, amount, deadline, and their link;
  - **Mandate:** approve it in your UPI app;
  - **Allotment:** did you get it?;
  - **Settle:** send back ₹X.
- **Placeholders:**
  - `{name}`, `{ipo}`, `{lots}`, `{amount}`, `{closes}`, `{link}`;
  - `{upi}`, `{gmp}`, `{back}`, `{missedLast}`.
- **Editing:** in Pool → Messages, with a live preview for a real partner and **Reset to ORVYN's**.
- **Rendering:** the server renders each message, so the web and Android send the same words. Asking moves **To ask
  → Asked** by itself.

## API

- `POST /ipo/pool/rounds` with `{ issueId, partnerIds: [] }` (an empty round is fine).
- `PUT /ipo/pool/rounds/:id/partners` with `{ partnerIds, status, lots?, category? }` adds people or sets their
  status (bulk). `DELETE /ipo/pool/rounds/:id/partners/:partnerId` removes someone with nothing recorded.
- `POST /ipo/pool/applications/:id/undo`.
- `POST /ipo/pool/rounds/:id/messages` with `{ partnerIds, kind }` returns `[{ partnerId, name, phone, text, url }]`.
- `GET /ipo/pool/templates`, `PUT /ipo/pool/templates`.
- The round view gains:
  - `roster` (everyone, in the round or not, with their track record);
  - `summary` (counts by stage, names that missed);
  - `closed`.

## Data

- `ipo_applications` gains `history` (jsonb).
- `ipo_pool_settings` (owner, templates).
- `ApplicationStatus` gains to_ask, asked, declined, no_reply and missed.
- Migration `0030_pool_roster.sql`.

## Also in this round (fixes)

1. **Android dark mode:**
   - the IPO tiles and the Brief's "your three" rows showed near-white boxes with light text;
   - the cause: the track colour's alpha was replaced, not multiplied;
   - all fixed.
2. **Brief → From your tools** lists the ClickUp tasks in working statuses (Design, Development, In progress…) as
   Today shows them, and the reviews waiting, each with a link.
3. **Mail counts:**
   - the Mail entry in the sidebar and launcher shows the **important** count (unread mail that matters);
   - the Mail page shows each mailbox as a pill with its colour, unread count and important count;
   - the Brief's mail section uses the smart inbox (important first) — **not done yet**.

## Acceptance criteria

- [x] AC1 A round starts empty. People are added one by one or all at once. Statuses move both ways, with history and
      Undo (API test).
- [x] AC2 At the close, Will apply/Money sent become Missed and Asked becomes No reply. One summary notification goes
      out. The next round shows "missed last time" (API test).
- [x] AC3 Templates are saved and rendered with placeholders. Asking moves To ask → Asked. Someone else's partner is
      never reachable (API test).
- [x] AC4 The Brief's tools section lists working ClickUp tasks (API test).
- [x] AC5 The web and Android round boards and the mail counts (tests).
- [ ] AC6 The template editor and the dark-mode fixes are built; they still need tests.
- [ ] AC7 The Brief's mail section uses the smart inbox.
