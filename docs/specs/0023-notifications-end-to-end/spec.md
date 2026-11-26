# 0023 — Every notification, end to end

Status: **Built, not deployed** · 2026-11-26 · Builds on spec 0019 (types and ways) and spec 0021 step 1.

## The path

`module → rule of the type → inbox → live socket (web, Chrome, PC) → push (Android, browser) → email / WhatsApp copies →
button, reply or tap → the module does it → cleared everywhere`. The audit followed all 26 types along it.

## What was broken, and is fixed

| #   | Where   | What happened                                                                                         |
| --- | ------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Server  | A push service that was down lost the notification. Retried now, only where it failed                 |
| 2   | Server  | Five such failures switched the phone off until ORVYN was opened again                                |
| 3   | Server  | A failed email or WhatsApp copy pushed (and rang) the phone again, up to five times                   |
| 4   | Server  | The second time under the same key, urgent repeats could never run; old repeats went on beside new    |
| 5   | Server  | Repeats reached phones and browsers only, not the PC or Chrome                                        |
| 6   | Server  | After quiet hours the PC waited up to 15 minutes; Chrome never showed it                              |
| 7   | Server  | A long text (Hindi: about 1,100 letters) was too big to push, and FCM's answer unregistered the phone |
| 8   | Server  | Snoozing an alarm brought back an ordinary notification                                               |
| 9   | Server  | Silent clears were sent as high priority, for which Android slows an app down                         |
| 10  | Web     | Muted and quiet ones still popped up; the list went stale after a lost connection                     |
| 11  | Web     | A browser that renewed its subscription got nothing until switched on again by hand                   |
| 12  | Web     | Clicking a push didn't mark it read; some clicks did nothing; "Review" of a sign-in was a dead page   |
| 13  | Chrome  | A second chat message or a repeat never showed; nothing was caught up on; Reply always failed         |
| 14  | Android | A tap that started ORVYN from closed was lost; on full-screen pages every tap and arrival was         |
| 15  | Android | Buttons that open something did nothing; links to other sites failed                                  |
| 16  | Android | An alarm rang twice (the phone's own and the push), and went on after Done elsewhere                  |
| 17  | Android | A button pressed while offline disappeared without doing anything                                     |
| 18  | Android | A second chat message was ignored while ORVYN was open; muted ones popped up                          |
| 19  | PC      | Toasts dismissed elsewhere while it slept stayed                                                      |

## What is needed from the founder

- **Firebase in the release.** The published Android app has no `google-services.json`, so it gets nothing while closed.
  GitHub → Settings → Secrets → `GOOGLE_SERVICES_JSON_B64`.
- **A signing key for Android** (`ANDROID_KEYSTORE_B64` and its three companions), or no update installs over the last.
- **WhatsApp** has no token on the server: that way is off.

## Known limits

- A browser cannot be told to remove a shown push while it is closed (a rule of web push).
- On Android, the phone maker's battery saver can hold pushes back; Settings → Notifications → delivery check tells.
- If the answer to a session refresh is lost on the way, the next one looks like a stolen token and signs the device out
  (ADR-0005's reuse rule has no grace). Not changed here: it is a security decision.

## Acceptance criteria

- [x] AC1 Every type in the catalog reaches the phone by its default ways (test).
- [x] AC2 A push service that is down loses nothing and unregisters nobody (test).
- [x] AC3 Repeats reach every device, work again under the same key, and end when acted on (tests).
- [x] AC4 Held by quiet hours: shown when they end (test). A phone's own alarm is not doubled (test).
- [x] AC5 A tap from closed, buttons that open, and a notification that speaks again work on Android (test).
- [ ] AC6 A real phone with Firebase: each of push, alarm, reply, and clear, seen by hand.
