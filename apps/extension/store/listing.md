# Chrome Web Store listing

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for, field by field. Copy
each block as it is. Upload `orvyn-chrome-store.zip` (from a release, or `pnpm --filter @orvyn/extension build:store`
and zip the contents of `dist/store`), never the release's `orvyn-chrome-extension.zip`: that one carries a `key`,
which the store refuses.

Every update needs a higher `version` in `apps/extension/vite.config.ts`.

---

## Store listing tab

**Name** (from the manifest): `ORVYN`

**Summary** (from the manifest, 132 characters max):

```
Keep, fill, find and remember anything on the web, and see where your day went.
```

**Description**:

```
ORVYN for Chrome brings your private ORVYN account to every page: keep it, do it, fill it, or find it again.

ORVYN is an open-source personal operating system: tasks, calendar, money, documents and passwords in one place you own. This extension connects to your ORVYN account (a self-hosted server, or an invitation to one).

KEEP ANYTHING
• Right-click a selection, link, image or page to drop it into ORVYN, add it to Today, or note it.
• Screenshot the visible page, or save an article to read later.
• Works offline: what you keep is queued and sent once you're back.

DO IT FROM THE ADDRESS BAR
Type "o" then a space:
• o call mom 6pm → a task in Today
• o spent 240 lunch → an expense in Money
• o ?passport → search your Library
• o !react hooks → find a page you read before

FILL ANY FORM
• Magic fill completes forms from your profile: rules first, then what you taught it, then AI.
• The AI sees only the form's field labels, never your values.
• Nothing is ever submitted for you, and Undo puts the form back.

YOUR VAULT, IN THE BROWSER
• Pick a login in the ORVYN popup and one click fills it.
• Offers to save or update a login after you sign in or sign up.
• Generates strong passwords and shows one-time codes.
• Zero-knowledge: the Vault is decrypted on your computer and its key is kept in memory only.

UNDERSTAND A PAGE
• Summary, key facts, the catch, things to do, or ask anything, only when you click.
• Compare several open tabs side by side.
• Sign-in pages, banks and payment pages are never read.

KNOW WHERE YOUR DAY WENT
• My Day shows each site and what you did there, with times and away time, merged with ORVYN on Windows.
• Recall finds "that page I read on Tuesday". Page text stays on this computer.
• Page memory: your last visit, total time, your notes and a price history.

STAY FOCUSED
• Tab stash: put a window away with a name, bring it back later or on a chosen day.
• Focus shield: during focus time, chosen sites show what you meant to do instead.
• Side panel and shortcuts: Alt+Shift+O open, Alt+Shift+D drop this page, Alt+Shift+F fill this form.

PRIVATE BY DESIGN
• No ads, no selling data, no tracking for anyone but you.
• Never records which keys you press, only how many.
• Open source under AGPL-3.0: read every line at https://github.com/shubham-dube/ORVYN

Needs an ORVYN account. ORVYN is free to self-host; see the GitHub page to run your own.
```

**Category**: Productivity → Workflow & Planning

**Language**: English

**Graphic assets** (in this folder):

| Field                        | File                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Store icon, 128×128          | `../public/icons/icon-128.png` (also inside the zip)                                         |
| Small promo tile, 440×280    | `promo-small-440x280.png`                                                                    |
| Marquee promo tile, 1400×560 | `promo-marquee-1400x560.png`                                                                 |
| Screenshots, 1280×800        | Take 3–5 in Chrome: the popup on Today, Magic fill on a form, Vault fill, My Day, page brain |

**Official URL**: none. **Homepage URL**: `https://orvyn.dubey.app` **Support URL**:
`https://github.com/shubham-dube/ORVYN/issues`

---

## Privacy tab

**Single purpose**:

```
ORVYN for Chrome connects the browser to the user's own ORVYN account so they can save what they find on the web, fill forms and logins from their own data, and see and search their own browsing day.
```

**Permission justifications**:

| Permission                                                           | Justification                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `identity`                                                           | Signs the extension in to the user's ORVYN account with `launchWebAuthFlow` (the "Connect to ORVYN" button).                                                                                                                               |
| `storage`                                                            | Keeps the account connection, settings, the offline queue and the Vault's session key (in session storage, memory only).                                                                                                                   |
| `unlimitedStorage`                                                   | Recall keeps the text of pages the user read on this computer only, so they can search it later; this grows past the default quota.                                                                                                        |
| `notifications`                                                      | Shows the user's ORVYN reminders and messages, and confirms saves, with buttons to open or dismiss.                                                                                                                                        |
| `alarms`                                                             | Sends My Day time in batches, retries the offline queue, and brings back a stashed set of tabs on the day the user chose.                                                                                                                  |
| `tabs`                                                               | Reads the current tab's address and title for saving a page, My Day, page memory and comparing open tabs; tab stash closes and reopens tabs.                                                                                               |
| `scripting`                                                          | Runs ORVYN's own bundled scripts in a page when the user asks to fill a form, fill a login, or read the page.                                                                                                                              |
| `contextMenus`                                                       | Adds "ORVYN" to the right-click menu to save a selection, link, image or page.                                                                                                                                                             |
| `sidePanel`                                                          | Shows ORVYN beside the page.                                                                                                                                                                                                               |
| `idle`                                                               | Tells My Day when the user is away from the computer, so away time is not counted as time on a site.                                                                                                                                       |
| `webNavigation`                                                      | Finds a page's frames, so forms and logins inside frames can be filled.                                                                                                                                                                    |
| Host permission (`http://*/*`, `https://*/*`) and the content script | The user can fill a form or login, save, read or track time on any site they choose, so the extension must work on all sites. It never acts on a page by itself: filling and reading happen on the user's click, and nothing is submitted. |

**Are you using remote code?** No, I am not using remote code. (All JavaScript and the libsodium WebAssembly are
bundled in the package.)

**Data usage**, tick:

- [x] Personally identifiable information (the account email)
- [x] Authentication information (Vault logins, encrypted on the device)
- [x] Financial and payment information (expenses the user adds; payment cards are never filled)
- [x] Web history (My Day)
- [x] User activity (counts of keys, clicks and scrolls; never which keys)
- [x] Website content (pages the user saves or asks to read)
- [ ] Health information, Personal communications, Location

And all three certifications: not sold to third parties; not used or transferred for purposes unrelated to the
single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL**: `https://orvyn.dubey.app/privacy`

---

## Distribution tab

**Visibility**: Unlisted. **Regions**: all.

## Test instructions tab (for the reviewer)

The hosted ORVYN is invite-only, so give the reviewer a way in, or the review fails with "could not verify
functionality". Before submitting: ORVYN web → **People → Invites** → switch on every module (at least Today, Drop,
Money, Vault, Library, Assistant and My Day) → leave the email empty → **Create invite link**, and paste it below.
An invite works once and expires, so make a fresh one for each submission. Once the review is done, remove the
reviewer's account from **People**.

```
ORVYN is invite-only. To test:
1. Open this invite link and sign in with any email you can read (a 6-digit code is emailed): <INVITE LINK>
2. Click the ORVYN icon in the toolbar → "Connect to ORVYN" → Approve.
3. Try: type "o spent 240 lunch" in the address bar; right-click any page → ORVYN → Drop; open any sign-up form and press Alt+Shift+F to fill it.
4. Vault: in the web app open Vault, set a passphrase, add a login for a test site, then open that site's sign-in page and pick the login in the ORVYN popup.
```

After it's published, add the store's item id to `EXTENSION_IDS` on the server (comma-separated, keeping the
existing ids) and redeploy, or "Connect to ORVYN" is refused.
