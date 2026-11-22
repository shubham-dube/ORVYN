# 0013 — Money, smarter: the money brain

Status: **Delivered** (API, web, Android), 2026-11-22. Decisions: D-0013-1…4.

## Why

Money already reads bank and UPI messages, learns from review replies and shows budgets. It still made the person do
the thinking: typing the same merchant, category and amount again and again; noticing alone that Swiggy cost 7× the
usual, that Uber charged twice, that Netflix went up, or that the month is heading over budget. The brain does that
thinking from the person's own history. It uses rules only, no AI, and nothing leaves ORVYN.

## What it does

### Smart fill (on the device: instant, offline)

- **As you type a merchant:** merchants you've paid that match, ranked by how often and how recently. Each shows its
  usual amount, its category and how many times. Tapping one fills the name, the usual amount (if none is typed
  yet), the category you always use and your usual account.
- **A merchant you know:** the category is picked for you, with the reason ("Like your last 5 at Swiggy"). The
  usual amounts appear as chips. Never paid before: the name's own hint ("Sounds like Food & dining").
- **Only an amount typed:** "You paid ₹45 to Chai Point". Who you paid that amount before (exact, or within 3% for
  3+ visits).
- **The typed money line** ("spent 240 at swiggy") also files by your history first.
- Anything the person picks themselves (category, account) is never overwritten.

### Captured payments file themselves (on the server)

- A payment read from a message, to a merchant you filed the same way at least 3 times and at least 80% of the
  time, is filed without asking: "Filed ₹290 at Blue Tokai — as Food & dining, like your last 3 payments there"
  (a quiet note with Change).
- Removing a learned rule now means **ask me again**. The rule is kept as "ask", so history doesn't file it either.

### The month, read for you (insights)

Computed by `moneyInsights()` in `packages/money/src/brain.ts`. The web runs it in the browser; Android gets it from
`GET /money/insights?month=`. Both use the same function. The cards:

| Card            | When                                                                                                    | A tap                     |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| Pace            | Spent so far, where the month is heading (everyday pace + bills still to come), vs budget or last month | —                         |
| Safe to spend   | Per day for the days left, after bills to come (with an overall budget)                                 | —                         |
| Charged twice?  | Same merchant and amount within 30 minutes                                                              | Compare, delete the extra |
| Unusual         | 2.5× a merchant's usual (4+ visits, ≥ ₹500 more)                                                        | Open the payment          |
| Price change    | A steady monthly charge whose price moved ≥ 5% (yearly effect shown)                                    | Merchant history          |
| Subscription?   | Monthly charges not tracked as repeating yet                                                            | Track it (pre-filled)     |
| Bills this week | Repeating payments due in the next 7 days                                                               | —                         |
| Top merchant    | The place you went most often this month                                                                | Merchant history          |
| Weekends        | ≥ 45% of spending on Saturdays and Sundays                                                              | —                         |
| No category     | 3+ payments without one                                                                                 | Quick file                |

Alerts come first, then warnings. The pace and safe-to-spend sit on one bar (spent, heading for, a budget marker).
Ten cards at most.

### Merchant sheet

From any payment ("See all at …") or a card: this year's total, number of payments, the usual amount, the last six
months as bars, recent payments (unusually large ones marked), and the usual category with its share. Actions:

- **File all as…** recategorises every payment there; history then files new ones the same way.
- **Rename everywhere** merges spellings ("AMZN MKTP" → Amazon).

### Quick file

Every payment without a category, with the likely ones as chips: your history for that merchant, the name's hint,
then your most used categories. One tap files it and every other uncategorised payment from the same merchant.

## Decisions

- **D-0013-1:** Rules, not AI. Everything is counting the person's own records.
- **D-0013-2:** File without asking only on 3+ consistent past choices (≥ 80%).
- **D-0013-3:** Removing a learned rule means "ask me" for that merchant from then on.
- **D-0013-4:** Insights run on the device on the web, and on the server for Android (the Dart app has no copy of
  the recurrence engine). It is the same function in both places.

## Tests

- `packages/money/test/brain.test.ts`: profiles, suggestions, confident filing, every card.
- API `money-brain.test.ts`: history filing, the insights endpoint, owner scope, a bad month.
- Android `money_brain_test.dart`: the Dart brain on the same cases, smart fill end to end, the insight strip →
  quick file.
