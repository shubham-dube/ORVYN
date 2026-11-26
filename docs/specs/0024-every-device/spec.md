# 0024 — My Day on every device, at once

Status: **Built** · 2026-11-26 · Builds on spec 0020 (the record) and 0021 (the PC).

## Goal

One day, whatever I used: the phone too, and several devices running at the same time, without a minute counted twice
and without one device hiding another.

## What each device records

| Device  | What                                                                 | How                                                   |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Chrome  | the page in front, searches, sound playing                           | the extension (spec 0020)                             |
| Windows | the program in front, its title, idle, locked, sound, counts of keys | the tray app (spec 0021)                              |
| Android | the app in front, while the screen is on and unlocked                | Android's usage record (Usage access), every hour too |

Android tells only which app, never what is inside it. The home screen, lock screen, notification shade and keyboard
are not apps. An app in front for hours with nothing happening counts 4 hours at most. Android keeps about a week of
that record, so a phone that was off or without ORVYN for days loses nothing newer than that.

## Several devices at once

- **Each device is its own line.** Two PCs, a laptop, a phone: each shows what was open on it, side by side.
- **A browser goes with its PC** when that PC's browser was in front for at least 30% of the browser's time; then it
  explains that PC's Chrome, as before. A browser on another computer stands on its own.
- **The day counts a minute once:** "In use" is any device in use.
- **Where the attention was**, moment by moment: a phone in hand first, then a device in use (the newest), then
  something playing, then nobody. Categories, deep work, switches and the story follow it.

## Also fixed: no more signing out by itself

A phone's notification buttons, its money reader and its hourly My Day each refresh the session on their own. Two at
once, or an answer lost on a bad network, looked like a stolen token and signed the device out. Now:

- **On Android, one refresh at a time:** the app, its notification buttons, its money reader and its hourly My Day
  share a lock.
- **On the server, once:** a lost answer may be asked for again with the old token, within 10 minutes, while the new
  token is unused. A second time, or after the new one was used, is still theft and signs the device out.

## Acceptance criteria

- [x] AC1 Phone apps become spans: screen off, lock and home end them; sending twice saves once (test).
- [x] AC2 Two PCs, a browser and a phone at once: each its own, the browser with its PC, the day once (tests).
- [x] AC3 Only when switched on and allowed on that phone; off and sign-out stop it and forget (test).
- [x] AC4 A lost refresh answer doesn't sign the device out; reuse after that still does (test).
- [ ] AC5 On a real phone: Usage access, a day of apps, and the hourly look with ORVYN closed.
