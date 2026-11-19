# Connections — Google (Calendar, Meet, Gmail), ClickUp, GitHub and any mailbox

Settings → **Connections** lists every account. Several of each are fine (personal + work Google, two ClickUp
workspaces…). Keys are sealed on the server (`CALENDAR_TOKEN_KEY`) and never reach a device.

## Google: Calendar, Meet, Gmail

1. Google Cloud console → **APIs & Services → Library**: enable **Google Calendar API** and (for mail) **Gmail API**.
2. **OAuth consent screen**: External; add your Google addresses as **test users** while it is in _Testing_.
   - In _Testing_, Google expires sign-ins after **7 days** — calendars stop syncing and ORVYN asks you to reconnect.
     Press **Publish app** (In production) to stop that. Calendar scopes need no review for personal use; you see an
     "unverified app" screen once per account — choose _Advanced → Go to ORVYN_.
   - **Gmail is a restricted permission.** It works for test users, and for yourself in production with the
     "unverified" screen; offering it to many other people would need Google's security review.
3. **Credentials → OAuth client ID → Web application**. Authorised redirect URI:
   `https://<your API host>/calendar/google/callback`. Put the id and secret in the server env as
   `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET`, set `CALENDAR_TOKEN_KEY` (`openssl rand -base64 32`), restart.
4. In ORVYN: Settings → Connections → **Google account**. For mail, press **Add Gmail** on that account.

What it does: Calendar both ways; **Schedule a meeting** (Today, Ctrl-K) creates the event with a Meet link on the
account you pick and Google emails the invitations; Home shows unread primary mail from accounts with Gmail.

## ClickUp

ClickUp → avatar → **Settings → Apps → API Token** → copy (`pk_…`) → ORVYN Settings → Connections → **ClickUp**.
Your open tasks (assigned to you, every workspace) appear in Today under "From ClickUp"; ticking one closes it in
ClickUp with that list's own closed status. **Add to ClickUp** creates a task in any list (assigned to you, with a due
day or time), and the date on a ClickUp task can be changed from Today. Add another ClickUp account the same way.

## GitHub

github.com → Settings → Developer settings → **Personal access tokens → Fine-grained** → pick the repositories →
permissions _Issues: read and write_, _Pull requests: read_ → copy (`github_pat_…`) → ORVYN → Connections →
**GitHub**. Today shows "From GitHub": issues assigned to you and pull requests waiting for your review. Closing an
issue closes it on GitHub (as completed); reviews open on GitHub.

## Mail: Zoho, Outlook, Yahoo, iCloud or any IMAP mailbox

ORVYN reads mail over IMAP (TLS, port 993) with an **app password**, never your normal password, and only reads:
nothing is marked read, moved or sent.

- **Zoho Mail:** Zoho Mail → Settings → Mail Accounts → **IMAP Access: on**. Then accounts.zoho.in (or .com) →
  Security → **App Passwords** → generate one named ORVYN. In ORVYN pick _Zoho Mail_, type your address and the app
  password. ORVYN tries `imap.zoho.in` (India data centre) first, then `imap.zoho.com`, and remembers the one that
  worked. Custom domains on Zoho work the same way.
- **Outlook / Hotmail, Yahoo, iCloud:** each needs two-step verification and an app password from its account page.
- **Other:** pick _Other (IMAP)_ and give the host.

Mail shows unread mail from the last 7 days across Gmail and these mailboxes. **Make a task** fills a task from the
mail — the subject without "Re:", a date if it names one ("by Friday"), the sender and a link — and you edit it before
saving. _Read it smarter_ asks the cheapest model (counts toward the daily AI budget) for a clearer to-do; the mail is
treated as data only.

## Notifications

Every 15 minutes the worker looks for new GitHub issues assigned to you, new review requests and new ClickUp tasks
assigned to you, and sends one notification each (at most three at a time, then a summary). Connecting an account
never floods you: the first look only remembers what's already there.

## Coming

Outlook / Microsoft 365 calendar, Notion, Slack — each slots into the same hub.
