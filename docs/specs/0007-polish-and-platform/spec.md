# Spec 0007: Make it work everywhere, make it beautiful, connect everything

Status: Approved scope (founder request, 2026-11-18, after the first deploy: API + Redis + worker on a GCP e2-micro,
web on Vercel, files on Cloudflare R2) · Modules: all

## Problems reported after deploy

1. Android: Library, Vault and other modules are hard to reach (the bottom bar has Home, Today, Money, Settings only).
2. AI costs must be as low as possible.
3. Today and Money on Android look cluttered (too many chips).
4. Long create forms put the submit button at the bottom.
5. File upload does not work in production (R2).
6. Web voice input writes the same words several times.
7. Voice recordings can't be kept; common files can't be viewed in the app.
8. Push (FCM), hard notifications and alarms must work on the phone as set.
9. Schedule meetings (Google Meet) with invitations from ORVYN, on any connected account.
10. Connect many kinds of accounts, several of each (Calendar, Meet, Gmail, ClickUp, …).
11. A public landing site with downloads (APK, Chrome extension, Windows).
12. The People page and module grants look poor.
13. Web widgets: native dropdowns are white-on-white in dark light; widgets need a proper set.
14. The UI is "good, not great": it must be beautiful, modern and have the best UX we can give it.
15. A captured payment should ask what it was (reply with a category, ignore it, …) and learn.
16. Loading states are missing on web.
17. A test from the phone did not reach Windows.
18. The Chrome extension should show tasks, money and more.
19. A brand: logo, app icons, favicon, splash.

## Root causes found (before any change)

- **Uploads**: the API only parses images, PDF, `text/plain` and octet streams, and the allow-list is images, PDF and
  plain text — so voice notes (`audio/webm`), Office files, CSV, ZIP and video fail with 415 before reaching R2. The
  R2 client itself is configured correctly (SDK 3.700, `region: auto`, before the checksum change that breaks R2).
- **Voice (web)**: the recogniser's `onresult` handler appends _all_ results every time it fires; Chrome fires it
  repeatedly (and on Android repeats cumulative finals), so the text multiplies.
- **Android navigation**: Library, Vault and Drop are only reachable from dashboard tiles or the Orb.
- **Push**: FCM needs `google-services.json` in the APK and `FCM_SERVICE_ACCOUNT_B64` on the server; without them the
  app silently falls back to "only while open". There is no way to see per-device delivery.
- **Windows**: the tray app gets notifications over the live socket; a browser on Windows needs web push (VAPID) and
  permission. Neither has a visible status or test.

## Plan (in order; each step ships tested and pushed)

**A — make it work**

- A1 Files: accept common types (images, PDF, text/CSV/JSON/Markdown, audio, video, Office documents, ZIP) up to 25
  MB; one storage self-check (`GET /files/health`, owner) that writes, reads and deletes an object and reports the
  exact error; an in-app viewer for images, PDF, audio, video and text, download for the rest (web + Android).
- A2 Voice: one voice hook on web — final results by `resultIndex`, interim shown live but never committed, repeated
  cumulative finals collapsed; the recording itself (MediaRecorder) can be kept as an audio file with the text.
- A3 Notifications: per-device delivery status (FCM token, web push subscription, live desktop socket, last result)
  and "test this device"; FCM setup guide; delivery errors stored (expired subscriptions removed).

**B — make it beautiful** (design system first, then screens)

- Brand: a mark (an orb with an orbit), wordmark, app icons (adaptive Android icon, PWA, favicon, extension, Windows),
  splash, OG image.
- Web widgets: Select/Menu (themed, keyboard), Skeletons on every data view, Dialog/Sheet with sticky action bars,
  DatePicker chips, Toasts with undo, empty states; dark-light contrast fixed everywhere (`color-scheme`).
- Android: a module launcher (every module one tap away), calmer Today and Money: one smart composer, quiet rows,
  details on demand; sheets with a sticky "Save" bar and "More options" instead of long forms.
- People: cards per person with module toggles as switches, invites with a copyable link, usage at a glance.

**C — make it smart and connected**

- C1 Smart transaction review: each captured payment notifies with the 3 most likely categories as buttons, "Not
  mine / ignore", and a reply box ("food", "split 200 rent", "ignore"). Replies are read by rules first; the
  merchant → category choice is remembered so the same merchant is filed silently next time ("always for Swiggy").
- C2 Connections: one hub for accounts of many providers, several accounts each (Google: Calendar, Meet, Gmail;
  ClickUp; more later). Tokens encrypted; each account lists what it can do. Schedule a meeting on any connected Google
  account: a Calendar event with a Meet link and attendees, Google emails the invitations.
- C3 Cheaper AI: rules and local parsers first, a result cache by content hash, the cheapest model that works per task
  with escalation only when the answer is unsure, images downscaled before sending, tight token limits.
- C4 Landing site (signed-out home + Features, Security, Download, FAQ, Privacy, Terms) with download links read from
  the release (APK, extension, Windows); the extension popup gets Today (tick tasks), Money (recent, add), Library
  search and capture.

## Out of scope for this round

The Assistant (spec 0005) resumes after this round. iOS stays the PWA.

## Delivered (2026-11-19)

| Step | What shipped                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Any common file type up to 25 MB; `GET /files/health` storage check (Settings); viewer for images, PDF, audio, video, text, CSV on web and Android.                                                                                    |
| A2   | One voice hook on web (no repeated words); keep the recording as a voice note.                                                                                                                                                         |
| A3   | Per-device delivery status and test; FCM / VAPID / Windows guide (`docs/guides/notifications.md`); Android alarm checklist.                                                                                                            |
| B    | Brand (mark, icons, splash, OG); themed dropdowns, skeletons, sticky sheet actions, new People page (web); module launcher, calm Today and Money, sticky forms (Android).                                                              |
| C1   | Captured payments ask "what was it?" with buttons and a reply box; rules read replies; learned merchant rules (Manage → Learned).                                                                                                      |
| C2   | Connections hub: several Google accounts (Calendar, Meet, optional Gmail), ClickUp by token; schedule meetings with Meet links and invitations; ClickUp in Today; Mail card. Guide: `docs/guides/connections.md`.                      |
| C3   | Rules before AI in Drop, cheap model first with escalation, per-person answer cache, photos shrunk before sending (decisions D-0007-1…4).                                                                                              |
| C4   | Public site (home, features, security, download, FAQ, privacy, terms) at `/` for new visitors; release workflow publishing APK, extension and Windows installer; extension popup with Today, Money, Inbox, Find and expenses in words. |

**Needs the founder:** Firebase project + `google-services.json` (as the `GOOGLE_SERVICES_JSON_B64` secret) and
`FCM_SERVICE_ACCOUNT_B64` on the server for Android push; VAPID keys for browser push; Google OAuth client (+ Gmail API)
for connections; repository variables `ORVYN_API_URL` / `ORVYN_WEB_URL` and a `v*` tag to publish downloads;
optionally an Android signing key; `NEXT_PUBLIC_CONTACT_EMAIL` for the site.
