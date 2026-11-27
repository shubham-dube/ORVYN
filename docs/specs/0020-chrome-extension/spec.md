# 0020 — ORVYN for Chrome, complete

Status: **Built, not deployed** · 2026-11-25 · Builds on specs 0001–0004 and 0007. ADR-0017, ADR-0018.

## Goal

**From any page: keep it, do it, fill it, or find it again.** At the end of the day, know exactly where the day went.

## What the founder changed (2026-11-25)

Saving passwords; complete day tracking; reading pages; filling any form from my data; original features; the Web Store
(a refusal is fine). So the extension now asks for access to all sites. What stays: nothing is submitted for me,
passwords are filled only after a click in ORVYN's own window, page text is data and never instructions.

## Features

| #   | Feature                  | How it works                                                                                                                                                                                                         |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fixed id                 | Unpacked production builds have a pinned id; the store build takes the store's                                                                                                                                       |
| 2   | Right-click → ORVYN      | Selection, link, image, page: Drop, Today, note on this page                                                                                                                                                         |
| 3   | Shortcuts                | Alt+Shift+O open, Alt+Shift+D drop this page, Alt+Shift+F fill this page                                                                                                                                             |
| 4   | Address bar              | `o call mom 6pm` → Today · `o spent 240 lunch` → Money · `o ?passport` → Library · `o !react hooks` → Recall                                                                                                         |
| 5   | Offline queue            | Kept on this device, sent once                                                                                                                                                                                       |
| 6   | Screenshot, read later   | The visible area → Drop; the article's text → Drop                                                                                                                                                                   |
| 7   | Side panel               | The same app, beside the page                                                                                                                                                                                        |
| 8   | **Magic fill**           | Fills any form from my profile: rules first, then what I taught it, then AI. AI sees the labels, **never my values**. Longer answers are drafted only when I ask                                                     |
| 9   | Learns                   | "Learn from this page" keeps my answers for next time                                                                                                                                                                |
| 10  | **Vault: fill and save** | Pick a login in the popup; one click fills. After a sign-up or sign-in it offers to save or update. Generates passwords. One-time codes                                                                              |
| 11  | **My Day**               | Every site and what I did there (the PR, the video, the search), with times, typing and clicking activity, away time. Merged with the Windows app (0021)                                                             |
| 12  | **Recall**               | "That page about… I read on Tuesday": pages I really read are searchable. Kept on this device only                                                                                                                   |
| 13  | Page brain               | Summary, key facts, the catch, things to do (added on my click), ask anything; compare open tabs. An answer that runs long is trimmed, not refused; one that still doesn't fit is retried once on the stronger model |
| 14  | Page memory              | On a page I've been to: last visit, total time, my notes, **price history**                                                                                                                                          |
| 15  | Tab stash                | Put a window away with a name; bring it back later, or on a day                                                                                                                                                      |
| 16  | Focus shield             | During focus, chosen sites show what I meant to do instead; every bypass is counted                                                                                                                                  |
| 17  | Job page → JobOS         | Opens JobOS on this PC with the link copied                                                                                                                                                                          |

**Left out:** reading the characters I type (only counts), submitting forms, filling payment cards, incognito windows.

## Safety (from everyone but me)

- The Vault key lives in memory only (`chrome.storage.session`), is dropped after the auto-lock time or when Chrome
  closes, and is never given to a page. Logins are chosen in the popup, so a page cannot overlay or click it. The saved
  host or its subdomain, https only, top frame only (ADR-0017).
- Content scripts run isolated, accept commands only from this extension, and never receive a token.
- Activity is sealed at rest per person and is not shown to anyone else, the admin included (ADR-0018). Query strings
  are not kept (they carry tokens), except the words of a search.
- Recall skips banks, payment pages, local addresses and any page with a password field.
- Every new API route needs its module (`activity`, `fill`, `assistant`) and is owner-scoped.
- **The popup opens where it is needed:** on the Vault when the page in front is a sign-in (a password box) or a
  sign-in waits to be saved; otherwise on Today. The Inbox tab carries its unread count.

## API

`/activity/spans`, `/activity/day`, `/activity/range`, `/activity/rules`, `/activity/story`, `DELETE /activity` ·
`/fill/profile`, `/fill/structure`, `/fill/map`, `/fill/draft` · `/page/read`. Shared rules: `packages/activity`.

## Acceptance criteria

- [x] AC1 Unpacked production builds have one id in any folder.
- [ ] AC2 Right-click, address bar and popup create the right item; offline ones arrive once. _Built; the
      right-click menu, address bar and offline queue have no automated test yet._
- [x] AC3 A form is filled with my values in controlled (React-style) and plain fields, nothing is submitted, Undo
      restores (Chromium).
- [x] AC4 The AI mapping request contains no profile values (test).
- [x] AC5 Vault refuses: locked, http, another host, a look-alike host, an iframe (test). Nothing readable on disk.
- [x] AC6 Save is offered after a login and updates an existing one (Chromium).
- [x] AC7 A day merges browser and PC time without counting a minute twice (test).
- [x] AC8 Someone else, or someone without the module, gets nothing (API test).
- [x] AC9 Recall finds a page read earlier and skips protected ones (test).
- [x] AC10 My Day shows the timeline, totals and story on the web.

## Cost

₹0 except AI: a form's labels once per form, page reads, and a day's story when asked, all inside the AI cap.
