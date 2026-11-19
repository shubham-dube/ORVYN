# IPO desk and IPO Pool — how to use it

## Turn on live data (once, on the server)

1. Sign up at **https://www.ipoguru.in/developer** (mobile OTP) and copy your API key (shown once).
2. On the server, set in `.env`:
   - `IPO_FEED=ipoguru`
   - `IPO_FEED_KEY=<your key>`
   - `IPO_FEED_DAILY_CALLS=10` (free plan) — raise it if you buy a plan.
   - `IPO_FEED_SUBSCRIPTION=true` only on the **Standard** plan (₹299/month) or above: live subscription by
     category every 30 minutes while bidding is open.
3. Restart the worker. GMP refreshes every 3 hours; closed and listed IPOs once a day.

Without a key everything still works: **Add by hand** in the desk, and **Type figures** on an IPO for GMP,
subscription and retail applications (which make the odds exact).

## Notifications

IPO desk → **Notifications**: minimum issue size (e.g. ₹1,000 cr+), mainboard and/or SME, a minimum GMP %, or only
IPOs you starred; then which moments (announced, opens, last day, GMP moves, retail 1×/10×/50×, allotment, listing).
Starred IPOs always pass. Each IPO and moment pings once; a daily cap keeps it calm.

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
