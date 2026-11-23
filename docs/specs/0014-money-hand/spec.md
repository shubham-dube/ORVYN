# 0014 — What's in my hand, who owes whom, and the round-4 polish

Status: **Delivered** (API, web, Android), 2026-11-23. Decisions: D-0014-1…6.

## Why

Money counted what was spent and what came in. It couldn't say what was **really yours right now**. A person with
₹2L in the bank, ₹1.5L due on a credit card, ₹20,000 lent to a friend and cash held for someone else has far less
than the bank app shows. Every credit also counted as income: a friend paying you back looked like a salary.
Alongside this round came a set of fixes from daily use: company pull requests missing, review requests not on the
task list, public holidays shown four times, and bottom sheets that were long lists of chips.

## What it does

### A. What's in my hand (`packages/money/src/hand.ts`, ported to `apps/mobile/lib/money/hand.dart`)

- Each account (bank, cash, wallet, UPI, **card**, **loan**) can carry a balance as of a moment (`balanceMinor` at
  `balanceAt`). Every payment on the account after that moves it: money in raises a bank balance and lowers a card's
  dues; money out does the opposite.
- A **move** (`toAccountId`) leaves one account and arrives in the other. Paying the card bill from the bank lowers
  both. A move is never spending.
- A card's **limit** minus its dues is shown as "card limit left". It is spendable, but not yours.
- **In your hand = accounts − card & loan dues − what you owe people + what will surely come back.** The card shows
  the number. A tap opens the breakdown: maybe-coming-back (not counted), card limit left, and accounts with no
  balance yet. The figure without what's still to come is shown underneath.
- Set up from the card ("Start") or from Money ⋯ → Balances & accounts. Balances are checked against the bank app
  now and then; ORVYN never reads a bank.

### B. Who owes whom (`money.iou`, synced, owner-scoped)

- A debt is a person, a direction (**they owe me / I owe them**), an amount, what's been paid back, a note, an
  optional due day, and **sure** (money owed to me only counts in my hand when I'm sure it comes back).
- Ways in:
  - the **Who owes whom** card (+);
  - in the payment sheet, **With someone → I lent it / paid for someone** (they owe me, not spending) or **I
    borrowed it / holding it for someone** (I owe, not income);
  - **paying back** an open debt from the same row.
- **A due day adds a task to Today** ("Get ₹2,000 back from Rahul"). Settling the debt ticks the task off.
- A person sheet shows everything with that person: record part of a payment, settle, or forget it.
- A payment linked to a debt (`iouId`) is `counted: false`, so lending is never spending and being paid back is
  never income.

### C. Money in waits for a yes

- A credit read from a message arrives **not counted** (`counted: false`). The question in Notifications is "₹X
  came in from Y". Its answers are:
  - **Y paying back**, when Y matches an open debt by name: the debt goes down and is settled when paid in full;
  - the likely income category, which counts it;
  - **Don't count it**;
  - **Reply** ("salary", "refund", "not counted"…);
  - **My own transfer**.
- In the list, a waiting credit has **Count it / Not income**. Typed money in counts at once, because the person
  said it themselves.
- Summaries, insights, budgets and the brief all leave out `counted: false`, the same way as transfers.

### D. Payments: a title, the merchant still visible

- `title` (what it was for: "Dinner with Riya") leads the row. The merchant (who was paid) is underneath with the
  category, account and time. The note is the description.
- Typed entries get a title only when it adds something ("240 lunch at swiggy" → **Lunch**, at Swiggy; "uber 180" →
  no title, **Uber**).

### E. Sheets, redesigned (Android first; the web follows the same order)

- **Payment sheet:**
  - top: **Spent / Got / Moved**, then a big amount in the colour of where it goes;
  - title and merchant inline, smart fill, categories as a grid of coloured icons;
  - one card of rows: When, From, To, With someone, Counts as…, Note, Repeats;
  - the button says what happens ("Add spending · ₹640").
- **Filters:**
  - in/out as a switch, this month / all time, categories as icons, accounts as pills;
  - applied as you tap; the button counts the matches ("Show 12").
- **Budget sheet:** Everything or a category, the amount large, remove in the header.
- **Task filters:**
  - When as six icon tiles, priority as one switch, projects with their colour dot, tags as pills;
  - "Show 3 tasks".
- **Quick add on Money** looks and behaves like Today's: focus glow, sparkles while it understands, chips that read
  the entry back, a round add button, ⤢ for details.
- **Month switcher:** one pill with the month between the arrows. Tapping the month goes back to this month (web);
  on Android, tapping it opens a month grid.

### F. One budget, not two

The overall budget lives on the pace card ("Set budget" / its amount opens the budget sheet). The budgets section
lists **category** budgets only. On the web, the top "Budgets" card is replaced by **In your hand**.

### G. GitHub: company pull requests, reviews as tasks

1. **Several tokens per GitHub person.** A fine-grained token sees one resource owner, so the user's own account and
   each organisation need their own token. They are separate connections (`externalId` = user id + token
   fingerprint). Each connection's label lists its organisations. PRs, reviews and issues are de-duplicated across
   tokens. The PR page offers "Missing PRs from your company? Add a token for that organisation". PRs opened from a
   personal fork into the company repo show through the organisation's token.
2. **A review requested from me becomes a task** in Today:
   - title "Review: <title> (#n)", tagged `review`, priority medium, with the link;
   - **dated the day the PR was raised** (in the person's time zone);
   - ticked off once the review no longer waits for me;
   - switch: "Add review requests to my tasks" in the PR notification settings (on by default).
3. **Today shows my open PRs inline** (up to 3, the ones that need me first: changes requested, failing checks,
   approved and ready to merge) above **Waiting for your review**.

### H. Public holidays, once (or not at all)

- Google's public-holiday calendars (`…#holiday@group.v.calendar.google.com`) are connected **hidden** from now on,
  even when Google shows them.
- Events are de-duplicated by title and time when expanded, so the same holiday from four accounts shows once.
- A holiday chip in Schedule carries a hide mark: **one tap hides every holiday calendar**. Settings → Calendars has
  "Hide public holidays" too. Each calendar can still be switched back on.

### I. Smaller fixes

- The New strip on Money has even padding; "All fine" only shows when there are payments to confirm.
- The Money quick-add field matches Today's quick add.

## Data

- `money_transactions`: `title` (≤120, default ''), `counted` (default true), `to_account_id`, `iou_id`.
- `money_accounts`: `kind` adds `loan`; `balance_minor`, `balance_at`, `credit_limit_minor`.
- `money_ious` (new, synced as `money.iou`).
- Migration `0026_money_hand.sql`.
- The server checks that `toAccountId` and `iouId` belong to the same owner.

## Tests

- `packages/money/test/hand.test.ts`: balances moved by payments, card dues, moves, what's in hand, people
  balances.
- API:
  - `money-hand.test.ts`: debts sync and are owner-only; a payment can't point at someone else's debt; captured
    credits wait; Don't count it; paying back settles a debt; a category counts it; typed credits count.
  - `connections-hub.test.ts`: a second token is its own connection, and nothing doubles; reviews become dated
    tasks and are ticked off.
  - `calendar.test.ts`: holiday calendars arrive hidden.
- Android:
  - `money_hand_test.dart`: in hand from a bank balance and a card due; lending from the payment sheet makes a debt,
    not spending; I owe someone; quick titles.
  - `today_refined_test.dart`: four holiday calendars show one chip, and one tap hides them all.
  - The money, filter and task tests are moved to the new sheets.

## Open questions

- Should ORVYN suggest checking a balance after N payments, or after a week, so drift stays small?
- Split groups (spec 0011) and debts are separate today. Should a Split balance appear in "Who owes whom"?
