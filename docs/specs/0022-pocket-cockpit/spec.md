# 0022 — Pocket Cockpit: the PC from the phone, the phone from the PC

Status: **Approved** 2026-11-26 · Builds on spec 0021 step 3 and ADR-0019.

## Goal

From the phone, anywhere: see what runs on the PC, act on it in one tap, and reach the real screen when only the real
screen will do. From the PC or web: use the phone.

## What is built and what is borrowed

| Need                                       | Choice                                                           | Why                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Screen, mouse, sign-in screen of the PC    | **Borrow RustDesk** over Tailscale, opened from ORVYN in one tap | Video, input and the sign-in screen are years of work; Windows Home has no RDP host |
| Apps, windows, IDE state, launch, terminal | **Build** in ORVYN (encrypted as in ADR-0019)                    | Faster than a tiny remote desktop on a phone; nothing to borrow fits                |
| Agent chat of an IDE (Antigravity)         | Screen first; a connector only if an official one appears        | Community bridges are unofficial; their standing with Google's terms is unclear     |
| Phone's screen on the PC                   | **Borrow** scrcpy (Wi-Fi, adb) and RustDesk for Android          | Mature, no root                                                                     |
| Phone actions, files, Linux terminal       | **Build** in ORVYN for Android, with Termux for the terminal     | No root needed                                                                      |

## Parts

1. **Cockpit** — cards of running programs and windows (picture on demand, title, not responding?), focus, close, open
   any app or project folder, Android Studio and Antigravity cards (project, running build, emulator, last error).
2. **Build buttons** — Gradle, Flutter, git, tests and adb install as one-tap commands with live output and a finish alert.
3. **Screen** — one tap opens RustDesk at this PC.
4. **Wake and unlock** — keep-awake while plugged in; Wake-on-LAN when wired with a helper at home; unlocking by typing
   the PIN at the sign-in screen through RustDesk. A one-tap unlock would keep the Windows password and is not planned.
5. **Phone** — ring, locate, battery, clipboard, files, open an app or link, notifications, screen view and touch
   (accessibility, switched on by me), terminal through Termux, adb-level commands through Shizuku.

## Decided (2026-11-26)

- RustDesk over Tailscale, no root. Order: terminal (0021 step 3), parts 1–2, part 3, part 5, then Continuum (restoring a past working state).
