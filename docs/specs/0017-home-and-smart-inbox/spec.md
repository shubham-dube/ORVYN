# 0017 — Home that knows what matters, and a smart inbox

Status: **Delivered** (API, web, Android), 2026-11-24. Decisions: D-0017-1…7. Builds on spec 0008 (mail), 0009/0016 (Brief).

## Why

- **Home is the screen opened most, but it is a stack of module cards.** It doesn't say what is happening now, what
  is next, or what needs attention across everything ORVYN knows.
- **Mail** from several accounts shows as unread lists, newest first. A bank alert, a friend's question, an OTP, a
  bill due tomorrow and a promotion all look the same. The important ones get lost.

## Part A — Home: "mission control"

Top to bottom (Android and web; web uses two columns):

1. **The hero:**
   - the date, the greeting and the weather (spec 0016);
   - the **Brief's AI line**, the first sentence of the opening;
   - a live clock.
2. **Now & next:**
   - the meeting going on (with time left), or the next one with a countdown;
   - a **Join** button when it has a Meet or Zoom link;
   - the next task with a time.
3. **Needs you:** one ranked list across modules. It holds what is waiting on me, in order of urgency (D-0017-1),
   each with one tap to act:
   - mail that needs a reply or a bill that is due (Part B);
   - IPOs closing today that I plan to apply for, or haven't decided on;
   - PR reviews waiting;
   - money due within two days (repeating payments and debts);
   - payments to look at;
   - overdue tasks;
   - documents expiring within a week;
   - Drop waiting.
4. **Today:**
   - a progress ring (done of planned);
   - **your three** with check-off and **Plan it** (spec 0016);
   - the day's free time.
5. **Money glance:**
   - in hand;
   - spent today and this month against the month's pace;
   - the next due payment.
6. **Smart inbox preview:** the top three important mails, each with its one-liner, and the catch-up line.
7. **Week strip:** seven days, how full each is, a tap opens Today on that day.
8. **Live:** open IPOs with their countdown, the markets.
9. **Quick actions:** task, expense, Drop, ask, find in Vault.
10. **Everything else:** the modules as a compact grid of icons.

Each block hides when it has nothing to say or the module isn't mine. The Home endpoint (`GET /home`) returns
everything that needs the server in one call. Today and Money stay local-first on each device.

## Part B — the smart inbox

### B1. Reading (D-0017-2)

- Every 15 minutes (and on pull-to-refresh), ORVYN reads **unread mail from the last 7 days** in every connected
  mailbox:
  - Gmail through each Google account;
  - IMAP for Zoho, Outlook, Yahoo, iCloud and others.
- At most 25 a box. Mail stays read-only, as before: nothing is marked, moved or deleted.
- Each new mail is kept for 14 days in `inbox_items`:
  - sender, subject, preview, account, link;
  - what ORVYN made of it.
- A mail that is no longer unread leaves the lists (marked `seen`) unless I pinned it.

### B2. Understanding (D-0017-3)

Each new mail is **triaged by the AI**, in batches, through the `ai` module with its budgets.

- **Category:**

  | Category        | What it means                                                         |
  | --------------- | --------------------------------------------------------------------- |
  | **needs reply** | a person asks me something                                            |
  | **action**      | something to do or sign                                               |
  | **bill**        | an amount due, with when                                              |
  | **money**       | credited, debited, refund, salary                                     |
  | **security**    | sign-in alert or OTP (never stored: the code is cut from the preview) |
  | **travel**      | tickets, PNR, check-in                                                |
  | **delivery**    | shipped, out for delivery                                             |
  | **event**       | an invitation or meeting                                              |
  | **work**        | from tools and colleagues                                             |
  | **update**      | an account notice                                                     |
  | **newsletter**  |                                                                       |
  | **promotion**   |                                                                       |
  | **social**      |                                                                       |

- **Importance** from 0 to 100, and **why**.
- **One line, "what's in it for you"**, e.g. "Your HDFC card bill: ₹18,230, due Thu 28 Nov".
- **Amount** and **due date** when there are any.
- A **suggested action:** reply, pay, add a task, track, add to calendar, or none.
- **Without AI, or when it fails or is paused, rules decide:**
  - who sent it: a person or an automated sender (no-reply);
  - words: due, invoice, OTP, offer, unsubscribe, shipped;
  - amounts in ₹.

### B3. Ordering

- **Important**, sorted by importance with the newest first:
  - needs reply, action, bills, money and security;
  - anything I marked **VIP**;
  - anything at 70 or more.
- **Updates:** travel, delivery, event, work, update.
- **Everything else:** newsletters, promotions, social; collapsed with a count.
- **Catch-up:** a short AI paragraph over the important ones ("Since yesterday: …"), refreshed when they change.
- **Senders I teach:**
  - **VIP** always goes to Important (at least 90);
  - **Mute** always goes to Everything else (at most 10).

  Kept in `inbox_senders`.

### B4. Acting

On each mail:

- **Open** (in Gmail or the webmail).
- **Task:** the AI proposes a title and date (spec 0008), and I confirm.
- **Remind me:** a task due tomorrow at 9:00.
- **Done:** it leaves my lists.
- **Pin.**
- **VIP / Mute the sender.**
- A bill also offers **Add to Money as due**: a task "Pay X ₹Y" due on its date.

### B5. Notifications (D-0017-4)

- A newly triaged mail that is important (needs reply, bill due within 3 days, security, or VIP) pings once:
  - "Asha: needs a reply — Contract draft for Friday";
  - with **Make a task** and **Done**.
- At most 5 a day, never in quiet hours, switchable in Settings → Mail.
- The Brief's Mail section shows the important count and the top three.

## API

- `GET /inbox` returns:
  - the catch-up;
  - important, updates and the rest (with counts);
  - the boxes and their problems.
- `POST /inbox/refresh`.
- `POST /inbox/items/:id/act` with `{ action: 'done'|'pin'|'unpin'|'remind' }`.
- `PUT /inbox/senders` with `{ email, rule: 'vip'|'mute'|null }`.
- `GET /inbox/settings`, `PUT /inbox/settings` (notify, max a day).
- `GET /home`: now & next is client-side; the server returns needs-you, the Brief line, the inbox top, open IPOs and
  the markets.

## Data

- `inbox_items`: owner, connection, external id, account, from name and email, subject, preview, at, url, category,
  score, summary, why, action, amount (paise), due date, state (new | seen | done), pinned, triaged by (ai | rules),
  notified at.
- `inbox_senders`: owner, email, rule.
- `inbox_settings`.
- Migration `0029_home_inbox.sql`.
- Owner-scoped (rule 5). Mail content is personal data like the Library: kept on ORVYN's server, readable by the AI
  for triage (D4); kept 14 days.

## Acceptance criteria

- [x] AC1 Mail from several accounts is triaged into Important, Updates and Everything else with one-liners. A VIP
      sender is always Important and a muted one never is. Another person's mail is never seen (API tests with fake
      mailboxes and a fake AI).
- [x] AC2 Without AI the rules still sort mail sensibly (API test). OTP codes never reach the database.
- [x] AC3 Done, pin, remind (a task tomorrow at 9:00) and Task work. A mail no longer unread leaves the lists (API
      tests).
- [x] AC4 An important new mail pings once, with Make a task and Done, inside the daily cap (API test).
- [x] AC5 `GET /home` returns needs-you in order of urgency across modules, only for modules I have (API test).
- [x] AC6 The web and Android Home and the smart Mail screens, with tests.

## Open questions

- Replying from ORVYN would need Gmail's send scope and SMTP for the others. Later?
- Marking as read or archiving in the mailbox needs Gmail's modify scope. Later?
