# Connections — Google (Calendar, Meet, Gmail) and ClickUp

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
ClickUp with that list's own closed status. Add another ClickUp account the same way.

## Coming

Outlook / Microsoft 365, Notion, GitHub, Slack — each slots into the same hub.
