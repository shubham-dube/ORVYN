# 0021 — ORVYN for Windows, complete

Status: **Approved with changes, next** · 2026-11-25 · Builds on specs 0001, 0002, 0007 and 0020 (its activity record).

## Goal

**The PC itself becomes part of ORVYN:** it knows how the day went, answers from the toast, and can be used from the
phone as if sitting at it.

## What the founder changed (2026-11-25)

Full tracking of apps and presence; reading other apps' windows; a chat reply from the toast (no chat window); running any
command on the PC from the phone with a full terminal; original features; SmartScreen warning accepted; JobOS control in
this tray; **no Vault here** (the extension and web have it). Security is for keeping others out.

## Features

| #   | Feature                 | How it works                                                                                                        | Step |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | **Tracking**            | Program in front, its title, idle, locked, asleep, counts of keys and clicks (never which). Feeds My Day            | 1    |
| 2   | What was in the window  | The text of the window in front, kept **on this PC only**, searchable: Recall for every program                     | 2    |
| 3   | Toasts that do things   | The notification's own buttons (today's toasts show only Open and Dismiss), alarms that ring, urgent ones that stay | 1    |
| 4   | Reply from the toast    | A text box in a chat toast; nothing else                                                                            | 1    |
| 5   | Catches up              | After sleep or a lost network, each missed notification once                                                        | 1    |
| 6   | One quick box           | Task, `spent 240 lunch`, `drop: …`, `?passport`, `!page I read`; kept and sent later when offline                   | 2    |
| 7   | Clipboard, screenshot   | A shortcut drops the clipboard, or a snip                                                                           | 2    |
| 8   | JobOS control           | Status, start, stop, open. Only the folder I chose                                                                  | 2    |
| 9   | Updates itself          | Signed update files from GitHub Releases                                                                            | 2    |
| 10  | **Terminal anywhere**   | A real PowerShell on the PC, in the phone's browser and the web app. It keeps running when the phone is closed      | 3    |
| 11  | **Remote deck**         | From the phone: see the screen, lock, sleep, volume, open a link, send the clipboard both ways, fetch a file        | 3    |
| 12  | **Say it, run it**      | Describe what you want; ORVYN shows the command; it runs only after you press Run                                   | 3    |
| 13  | **Tell me when done**   | Any long command (build, download, JobOS run) notifies every device when it ends, with the last lines               | 3    |
| 14  | **Pick up where I was** | Back at the desk: what was open, what was half done, what arrived meanwhile                                         | 4    |
| 15  | **Rewind**              | "What was I doing at 4 pm?" opens those files, pages and folders again                                              | 4    |
| 16  | **Autopilot rules**     | "When I open VS Code after 9, start focus"; "when I lock the PC, pause music and stop the timer". A list I wrote    | 4    |
| 17  | **Break sense**         | Suggests a break from real rhythm (typing pace falling, switching rising), not a fixed clock                        | 4    |

## Terminal anywhere: how others are kept out (ADR-0019)

- The phone and the PC share a key made on the PC and shown there once as a QR code and text. **The server never has
  it**, so it can neither read nor send a command. A stolen ORVYN account alone cannot run anything.
- Off until switched on at the PC. Each paired device is listed there and can be removed there.
- Every message is encrypted and numbered: no reading, changing, repeating or reordering.
- A session needs the PIN set at the PC; five wrong tries lock it until someone is at the PC. Idle for 15 minutes ends it.
- The tray shows a clear mark while a session is open, with End. Every session is logged on the PC.
- Runs as me, never as administrator.

## Acceptance criteria

- [ ] AC1 A day merges PC and browser without counting a minute twice; no characters are ever stored (test).
- [ ] AC2 A chat toast reply is sent once; every notification button works from the toast.
- [ ] AC3 A message changed, repeated, reordered, or from an unpaired device runs nothing (tests).
- [ ] AC4 The server's database and logs hold nothing readable from a terminal session (test).
- [ ] AC5 Five wrong PINs lock it; removing a device at the PC ends its session at once (tests).
- [ ] AC6 A full-screen program (an editor, `top`) works in the phone browser; a dropped phone reconnects to the same session.
- [ ] AC7 AI never runs a command: Run is always pressed (test).
- [ ] AC8 Under 80 MB and 1% CPU idle over 10 minutes (measured).
- [ ] AC9 After an hour asleep, each missed notification shows once.

## Cost

₹0 to run. AI only in 12 (a few words) and when asked.
