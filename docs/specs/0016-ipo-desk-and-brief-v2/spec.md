# 0016 — The IPO desk, sharper; a Brief with a brain

Status: **Delivered** (API, web, Android), 2026-11-24. Decisions: D-0016-1…8. Builds on spec 0010 (IPO) and spec 0009 (Brief).

## Why

- **IPO:** SME issues crowd out the mainboard ones people actually apply to. Cards don't show the four numbers that
  decide an IPO: **issue size, GMP, what one lot costs, and the dates**. The detail page is a list of figures. Nothing
  connects "this IPO is worth it" to "I applied before 5 pm on the last day".
  - **Data:** the free IPO Guru plan allows 10 calls a day, one a minute. The calendar call (`/ipos`) already returns
    every card figure, but ORVYN used the thin `/gmp` call for current IPOs.
- **Brief:** it is the start of the day, but it reads like a report: counts, no voice, nothing about the weather, the
  markets, IPOs, what is due in money, or how to fit the day's work around the meetings.

## Part A — IPO desk

### A1. Mainboard first

The desk shows **mainboard** IPOs. A **Mainboard · SME · All** switch shows the others. The choice is kept in IPO
settings (`showSme`), so it follows the person to every device. Notifications keep their own type filter (spec 0010).

### A2. Data from the calendar (D-0016-1)

- **Every 3 hours:** one `/ipos?months=2&limit=100` call gives everything a card shows for every IPO:
  - dates, price band, lot size;
  - **minimum investment** and issue size;
  - logo, GMP with % and estimated listing, kostak and subject-to-sauda;
  - subscription total, listing price and gain, and the current price.
- **Spare calls** fetch the detail of open and newly announced mainboard IPOs: category-wise subscription, refund and
  demat dates, face value, the exchanges and the type of sale.
  - Details from paid plans are parsed and shown when present: company about, strengths and risks, objects,
    financials, lead managers, registrar, reservation and lot table.
- **At most one call a minute** (`IPO_FEED_PER_MIN`). The 30-minute tick spends what's left of the day's calls.

### A3. The card

| Where      | What                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Top        | Logo (or monogram), name, a **status pill with a countdown** ("Closes today 5 pm", "Opens Mon", "Lists Thu"), my decision tag |
| Four tiles | **Issue size** ₹8,981 cr · **GMP** +₹21.5 (12.5%), green or red · **1 lot** ₹14,964 (87 shares) · **Dates** 1–3 Dec           |
| Bottom     | Live subscription bar (retail and total) when open · **+₹1,870 a lot** at today's GMP · the verdict line                      |

### A4. The detail page

A hero with the logo, name and price band, then the **GMP card**:

- estimated listing price and gain per lot;
- the GMP trend as a sparkline from ORVYN's own snapshots;
- when it was updated.

Below that:

- **Key facts:** issue size, lot, minimum investment, face value, listing at, type of sale.
- **Timeline:** open → close → allotment → refund → demat → listing, with today marked.
- **Subscription** by category as bars, with when the exchange last updated.
- **Your odds** and **Pool** (spec 0010).
- **Company** (when the plan gives it).
- **Your plan:** I'll apply · Skip · Applied · Allotted.
- The source credit (D-0016-8).

### A5. Will you apply? (D-0016-2, D-0016-3)

- The "announced" and "opens today" notifications ask **"Will you apply?"**: **I'll apply** · **Skip**. The same
  buttons are on the card and the detail page.
- **I'll apply** adds a Today task: "Apply for Matangi Rubber IPO".
  - It is due on the close day at the **apply-by time** (default 14:00, before UPI mandates get slow and bids close
    at 5 pm).
  - It carries a reminder in the morning of the close day (09:30), the price, the lot and the link in its notes, and
    is tagged `ipo`.
- **Close day, 10:00**, if I said I'd apply and the task isn't done: "Last day for X — applied?" **Applied ✓** (ticks
  the task) · **Skip** (removes it).
- **Allotment day, 18:00**, if I applied: "X allotment is out — did you get it?" **Got it 🎉** · **Not this time**.
- **Listing day, 09:15**, if allotted: "X lists today at 10 am. GMP ₹21.5 → about +₹1,870."
- Every step is once per IPO, inside the daily cap and quiet hours, and switchable (event `decide`).

### A6. Notification settings, redone

- **Show:** mainboard / SME / all (the desk) and whether SME may notify.
- **Filters:** minimum issue size, minimum GMP %, only starred.
- **Events**, each with one line saying what it does: announced, opens, last day, GMP moved by X%, subscription
  milestones, allotment, listing, and **ask me and follow up** (A5).
- **Apply-by time.**
- **At most N a day.**

## Part B — the Brief, with a brain

### B1. What it says

| Section                   | New                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opening**               | A short paragraph **written by the AI** from the Brief's facts. It sets the scene, names the one thing that matters most, and gives one suggestion. Without AI, or if it fails, the rules' headline stays (D-0016-5). |
| **Weather**               | Now and today's high/low, chance of rain, sunrise and sunset, for the place set in Brief settings (Open-Meteo, no key). One line of advice ("Carry an umbrella after 4 pm").                                          |
| **Focus**                 | **Your three for today**, from priority, due date and overdue. Each is paired with a **free slot** between meetings ("11:00–12:30 is free"). **Plan it** puts the task in that slot through sync.                     |
| **Agenda**                | As before, plus the **free time** between meetings.                                                                                                                                                                   |
| **Money**                 | As before, plus **what's in hand** (spec 0014), **dues soon** (card bills, repeating payments and debts due in the next 3 days) and money owed to me that is due.                                                     |
| **IPO**                   | Open today and closing today (with GMP, lot, my decision), allotments and listings today, and my applications in flight.                                                                                              |
| **Markets**               | Nifty 50 and Sensex: the last close and its change (best effort, left out when unavailable).                                                                                                                          |
| **Yesterday**             | Tasks done, spent, and a streak of days with all due tasks done.                                                                                                                                                      |
| Drop, Library, Work, Mail | As before.                                                                                                                                                                                                            |

### B2. How it behaves

- Built at the chosen time (spec 0009). The push leads with the AI's first sentence, or the headline.
- Each section has one tap to act: Plan it, Open, Applied, Mark done.
- **Settings:**
  - the place for the weather;
  - **Write with AI** (on by default when AI is set up), with a note that the Brief's facts go to the AI provider;
  - sections;
  - nudges (spec 0009).
- **The AI never acts** (rule 4). It writes words only; every change is a tap.

## Data

- `ipo_issues` gains:
  - `logo`, `min_investment`, `face_value`, `listing_on`, `sale_type`;
  - `listing_gain_pct`, `cmp`, `kostak`, `sauda`;
  - `details` (jsonb).
- `ipo_decisions` (new, per person, per IPO):
  - `decision`: applying | skipped | applied | allotted | not_allotted;
  - `task_id`, `updated_at`.
- `IpoSettings` gains `showSme`, `applyBy`, and the event `decide`.
- `BriefSettings` gains `place` (name, latitude, longitude), `ai`, and the sections weather, focus, ipo, markets and
  yesterday.
- Migration `0028_ipo_brief_v2.sql`.

## API

- `GET /ipo/issues?when=current&type=mainboard|sme|all` (default: the person's `showSme` choice).
- `PUT /ipo/issues/:id/decision` with `{decision}`, which creates, ticks or removes the task.
- Notification actions `apply`, `skip`, `applied`, `allotted` and `missed` on IPO notifications.
- `GET /brief/places?q=` (geocoding) and `POST /brief/plan` with `{taskId, start, minutes}`, which sets the task's
  time block through sync.

## Acceptance criteria

- [x] AC1 The desk shows mainboard only by default; the switch shows SME/all and is remembered (API + clients).
- [x] AC2 One calendar call fills price, lot, minimum investment, issue size, GMP and dates; calls stay within the
      daily and per-minute limits (API test).
- [x] AC3 I'll apply creates exactly one task, due on the close day at the apply-by time with a morning reminder.
      Applied ticks it; Skip removes it. Allotment and listing follow-ups go once each (API tests).
- [x] AC4 The Brief adds weather, focus with free slots, IPO, money dues, markets and yesterday. A failing outside
      source is simply left out (API tests with fakes).
- [x] AC5 With AI on, the Brief carries a written opening built only from its facts. With AI off or failing it still
      builds. Plan it sets the task's slot through sync (API tests).
- [x] AC6 The web and Android desk, detail, settings and Brief screens are redesigned, with tests.

## Open questions

- Company financials, lead managers and the lot table need IPO Guru Basic (₹99/month, 250 calls a day). Upgrade?
- Live category subscription during bidding needs Standard (₹299/month).
- An evening "tomorrow" Brief?
