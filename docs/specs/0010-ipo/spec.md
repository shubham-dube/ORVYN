# Spec 0010: IPO desk and IPO Pool

Status: Delivered 2026-11-19 (API, web, Android; guide in docs/guides/ipo.md) · Roadmap step 7 (features.md #8; D-0008-2; D-0010-*) · Module: `ipo`

## Problem

**The desk.** Indian IPOs move fast: grey-market premium (GMP), live subscription by category, issue size and dates
decide whether an IPO is worth applying to. Today this is spread over several websites, and nothing tells you what
_your_ odds are, or only pings you about the IPOs you care about.

**The pool (the founder's own problem).** The founder applies to IPOs through several people's accounts — family and
friends — giving each about ₹15,000 per IPO. The money comes from different places (his brother, his father, himself,
or cash drawn on a credit card at a 2–3% cost) and goes by different routes. After listing, each person who got an
allotment sells, keeps an agreed share of the profit and sends the rest back. It is impossible to keep track of who
holds how much, for which IPO, whether they applied, what the cards cost, what is owed to whom, and in the end
**where the profit went**.

## Part A — the IPO desk

### What it shows

- **Calendar:** open, upcoming, closed (awaiting listing) and recently listed mainboard and SME IPOs: price band, lot
  size, minimum investment, **issue size**, dates (open, close, allotment, refund, listing).
- **GMP:** the latest grey-market premium, its % of the price, the estimated listing price, **its trend** (ORVYN keeps
  its own history from every refresh), and the time it was updated. Always labelled _unofficial_.
- **Live subscription** by category (QIB, NII with sNII/bNII, retail, employee, shareholder, total) and applications,
  with the time of the exchange's last figure.
- **Your odds** (the allotment model below): the chance of an allotment per application in retail and in sNII, the
  number of lots on offer, and — with your Pool — the chance that at least one of your accounts gets one, the expected
  number of allotments and the **expected profit after your costs**.
- **Verdict line**, by rules (not AI, not advice): "Strong demand, GMP 32%, worth applying from all 8 accounts:
  ~1.6 allotments expected, +₹3,900 after card costs." The AI analyst (RHP reading) stays for later.
- Every figure carries its source and time; the provider's credit link is shown wherever its data appears.

### Allotment model (spec'd so it can be tested)

Retail (up to ₹2 lakh) and sNII (₹2–10 lakh) are lotteries when oversubscribed: every winner gets the minimum
application (1 lot in retail; the smallest lot multiple above ₹2 lakh in sNII), and the chance is the number of
minimum applications that fit in the category's shares over the number of applications.

- Lots on offer in a category: `floor(sharesOffered(category) / minApplicationShares(category))`.
- With the number of applications known: `p = min(1, lots / applications)`.
- With only the subscription multiple known: `p ≈ min(1, 1 / times)` (most applications are the minimum); marked
  _estimate_.
- Before bidding: shares offered from the issue size and the category's quota (retail 35% of a mainboard issue unless
  the offer document says otherwise; sNII one third of NII) — lots on offer only, no odds yet.
- Not oversubscribed: `p = 1`.
- Across `n` accounts in the same category: expected allotments `n·p`; at least one `1 − (1 − p)^n`.
- Expected profit: `expected allotments × lot size × GMP − card fees on money that still has to be sent − sale costs`.

### Notifications, the way you want them (settings)

Rules filter the IPO catalogue, events decide when to ping:

- **Filters:** minimum issue size (e.g. ₹1,000 crore and above), mainboard / SME, minimum GMP %, and "only IPOs I
  starred". Starred IPOs always pass the filters.
- **Events** (each on/off): a new IPO is announced · it opens today · last day to apply (morning) · GMP moved by more
  than X% · retail subscription crosses 1×, 10×, 50× · allotment day · listing day (with the gain at the open).
- Each IPO and event notifies once; quiet hours apply; a daily cap keeps it calm. In the Brief, open IPOs that pass
  your filters appear too.

### Data (D-0010-1, ADR-0013)

A pluggable feed (`IpoFeed`): the first one is **IPO Guru's API** (key in `IPO_FEED_KEY`; calendar, details and GMP
on its free plan; live subscription on its Standard plan, ₹299/month). Until a key is set — or for anything the
plan doesn't cover — the owner can **type figures in** (GMP, subscription per category, applications) and add an IPO
by hand; typed figures are marked as such. Refresh: GMP every 3 hours (fits the free plan's 10 calls a day);
subscription every 30 minutes during bidding hours when the plan allows.

## Part B — the IPO Pool (built for the founder)

### Words

- **Partner:** a person whose account applies (name, phone, UPI ID, relation, which categories they can apply in,
  their **share rule**: nothing / a fixed amount per allotment / a % of the profit).
- **Source:** where money comes from: _Me_, _Brother_, _Dad_, a **credit card** (with its cost %, e.g. 2.5%), or any
  source you define. A source can be **to repay** (money borrowed from someone) or not.
- **Round:** one IPO with the partners you chose, each an **application** (category, lots, amount).
- **Ledger:** every movement of money, each one between two parties (a source, a partner, you) with method (UPI,
  IMPS, cash…) and date. Balances are never typed — they are always the sum of the ledger.

### What it does

1. **Float-aware planning.** Money blocked for an IPO comes back to the partner's account if there is no allotment
   — it is still yours, sitting with them. ORVYN knows each partner's **float** (what they hold of yours), so for a
   new IPO it shows exactly who needs money and how much: "Ravi already holds ₹15,000 — nothing to send. Priya needs
   ₹2,000." It suggests the **cheapest source** (your own money before family, family before a card) and shows the
   card cost before you send anything.
2. **One tap per transfer.** "Sent ₹15,000 to Priya from HDFC card by UPI" — the ledger gets the transfer and its
   card fee (₹375) as a cost of that round.
3. **Application checklist** per round: planned → money sent → applied → mandate accepted → allotted / not →
   sold → settled; a nudge to you when partners haven't applied and the IPO closes today.
4. **Partner link (no app needed).** Each partner can get a private link (sent from your WhatsApp in one tap):
   what to apply for, the amount and the deadline, with buttons **I applied**, **Mandate accepted**, **Allotted / Not
   allotted**, and **I sold at ₹…**; it also shows what they hold of yours and their profit share. Each tap updates
   your round and pings you. Links are revocable and expire (ADR-0013).
5. **Allotment and sale.** Mark allotments (or let partners do it); enter the sale price (the listing price is
   suggested); ORVYN works out the gain, the partner's share by their rule, and what they should send back.
6. **Settlement.** "Ravi: sold 1 lot, gain ₹2,400, his share ₹600 → he sends you ₹16,650" — recorded when it
   arrives; principal can stay with him as float for the next IPO or come home.
7. **Where my profit went.** Per round and overall, a waterfall: gross listing gains → card fees → other costs →
   partners' shares → **net to you**; plus **money out there** (each partner's float, shares not yet sold) and
   **what you owe** each source to repay (Brother, Dad).
8. **Statements:** a running statement per partner and per source, exportable.

### Rules

- Owner-only (`ipo` entitlement); every Pool row is the owner's; a partner link shows one partner's own items and
  nothing else.
- ORVYN never moves money or applies: it records what you did and what partners report.
- Tax and legal: gains are taxed in the name of the account holder who sold; money given to non-relatives above
  ₹50,000 a year can be taxable for them. ORVYN keeps the record; it is not tax advice.

## API (summary)

`/ipo/issues` (filters, detail with odds, history, starring, manual figures) · `/ipo/settings` · `/ipo/pool/partners`
· `/ipo/pool/sources` · `/ipo/pool/rounds` (+ plan, applications, status) · `/ipo/pool/ledger` · `/ipo/pool/summary` ·
`/ipo/pool/partners/:id/link` · public `/p/:token` (partner page) and its actions.

## Clients

Web: `/ipo` (Desk: list with filters, detail with odds and charts; Pool: partners, sources, rounds, ledger, profit),
settings sheet. Android: the same, and the partner page is a web page that works on any phone.

## Acceptance criteria

- [x] AC1 Calendar, GMP (with history) and subscription from the feed, or typed by hand when there is none.
- [x] AC2 Odds and expected profit follow the model above (unit tests with worked examples).
- [x] AC3 Notifications follow the filters and events in settings; each fires once.
- [x] AC4 The Pool plan uses each partner's float and the cheapest source; card fees are recorded as costs.
- [x] AC5 Balances (float per partner, owed per source, profit per round) always equal the ledger.
- [x] AC6 A partner link shows only that partner's items, updates the round, expires and can be revoked.
- [x] AC7 Owner-only; nobody else reaches any of it (two-person test).
- [x] AC8 Web and Android screens with tests.

## Open questions

- IPO Guru plan: free (no live subscription; type figures in) or Standard (₹299/month) for live subscription?
- Partner messages by WhatsApp Business API (needs approved templates) or only your own WhatsApp (one tap)?
