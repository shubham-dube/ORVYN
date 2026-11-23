# IPO desk and IPO Pool — how to use it

## Turn on live data (once, on the server)

1. Sign up at **https://www.ipoguru.in/developer** (mobile OTP) and copy your API key (shown once).
2. On the server, set in `.env`:
   - `IPO_FEED=ipoguru`
   - `IPO_FEED_KEY=<your key>`
   - `IPO_FEED_DAILY_CALLS=10` and `IPO_FEED_PER_MIN=1` (free plan) — raise both if you buy a plan (Basic: 250
     and 10).
   - `IPO_FEED_SUBSCRIPTION=true` only on the **Standard** plan (₹299/month) or above: live subscription by
     category every 30 minutes while bidding is open.
3. Restart the worker. One calendar call every 3 hours brings every IPO's price, lot, minimum investment, issue size,
   dates and GMP. The day's spare calls fetch details (category-wise subscription, refund and demat dates) of open
   and upcoming mainboard IPOs first. On IPO Guru's **Basic** plan (₹99/month) the detail page also shows the company,
   its financials, lead managers, registrar and the lot table.

Without a key everything still works: **Add by hand** in the desk, and **Type figures** on an IPO for GMP,
subscription and retail applications (which make the odds exact).

## The desk

- **Mainboard** shows by default; switch to **SME** or **All** at the top. The choice follows you to every device.
- Each card shows the four numbers that decide an IPO — **issue size, GMP, what one lot costs, and the dates** — with
  a countdown ("Closes today · 5 pm"), retail demand, and what a lot may make at today's GMP.
- **I'll apply** (on the card, the detail page, the Brief or the notification) adds a Today task, due on the last day
  at your **apply-by time** (2 pm by default), reminded that morning. Then:
  - On the last day at 10 am, if the task isn't done: "applied?" → **Applied ✓** ticks it.
  - On allotment evening: "did you get it?" → **Got it** / **Not this time**.
  - On listing morning, if you got it: what your lot may make, so you can decide to sell at the open or hold.

## Notifications

IPO desk → the bell: what the desk shows (SME too or not), **Will you apply?** (ask and follow up, and the apply-by
time), which IPOs ping you (minimum issue size, a minimum GMP %, mainboard and/or SME, or only starred), which moments
(announced, opens, last day, GMP moves, retail 1×/10×/50×, allotment, listing) and at most how many a day. Starred
IPOs always pass. Each IPO and moment pings once; quiet hours apply.

## The Pool, step by step

1. **My Pool → Where the money comes from:** _Me_ is already there. Add _Brother_ and _Dad_ (family, paid back),
   and each card you draw cash from, with its cost (e.g. 2.5%).
2. **Partners:** add each person whose account applies, with their WhatsApp number, UPI ID and their share
   (nothing, a fixed ₹ per allotment, or a % of the gain).
3. **An IPO:** open it in the Desk → **Apply from my accounts** → pick partners → **Plan it**. The round shows who
   already holds enough of your money (nothing to send) and who needs how much, from the cheapest source.
4. **Record each transfer** (one tap). A card transfer records its fee as a cost of that IPO.
5. **Ask on WhatsApp** sends the partner their private page: they tap _I applied_, _Mandate accepted_, _I got it /
   Not allotted_ and _I sold at ₹…_. You get a notification for each.
6. **After listing:** the round shows the gain, their share and what they send back. **Settle**: everything back,
   or only the profit while the principal stays with them for the next IPO.
7. **My Pool** always shows: net profit after costs and shares (_where the profit went_), your money with each
   partner, shares not sold yet, and what you still owe Brother or Dad.

Nothing moves money: ORVYN keeps the record. Gains are taxed in the name of the person who sold; this is not tax
advice.
