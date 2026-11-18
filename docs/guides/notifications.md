# Notifications on every device — setup and checks

ORVYN reaches a device in one of three ways:

| Device                                         | While ORVYN is open | When it is closed                               | Needs on the server                                           |
| ---------------------------------------------- | ------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Android app                                    | live socket         | **FCM** push (rings alarms, actions)            | `FCM_SERVICE_ACCOUNT_B64` + `google-services.json` in the APK |
| Browser (Chrome/Edge on Windows, Mac, Android) | live socket         | **Web Push**                                    | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`      |
| Windows tray app                               | live socket         | — (it runs in the tray, so it is always "open") | nothing extra                                                 |

**Check it:** web → Settings → Notifications → _Your devices_ lists every signed-in device with "open now", whether
push works and the last answer from the push service. **Test** sends to that device only and shows exactly what
happened ("FCM_SERVICE_ACCOUNT_B64 is not set", "this browser's subscription expired", "403 …").

## 1. Android push (FCM) — about 5 minutes

1. Open <https://console.firebase.google.com> → **Add project** → choose your existing Google Cloud project (the one
   the VM is in) so billing and keys stay in one place. Analytics is not needed.
2. **Add app → Android**. Package name: `app.dubey.orvyn`. Download **google-services.json**.
3. Put it at `apps/mobile/android/app/google-services.json` (it is git-ignored) and build the APK again
   (`cd apps/mobile && flutter build apk --release`). The build applies Firebase only when this file exists.
4. Firebase console → ⚙ **Project settings → Service accounts → Generate new private key**. Then on your machine:
   `base64 -w0 service-account.json` and put the output in the server's env as `FCM_SERVICE_ACCOUNT_B64=…`.
   Restart the API (`docker compose --env-file .env.prod up -d api`).
5. Install the new APK, sign in, allow notifications. Settings → Notifications → Your devices → **Test** on the phone.

## 2. Browser push (Web Push) — 2 minutes

1. `npx web-push generate-vapid-keys` → set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
   `VAPID_SUBJECT=mailto:you@yourdomain` on the server. Restart the API.
2. In each browser (e.g. Chrome on Windows): Settings → Notifications → **Turn on** and allow the prompt.
3. On Windows, also check **Windows Settings → System → Notifications**: notifications on, and Chrome/Edge on; and
   that _Do not disturb_ / _Focus_ is off. Chrome only shows notifications while it runs (it can run in the
   background: chrome://settings/system → "Continue running background apps").
4. Test from Settings → Your devices.

Changing the VAPID keys later invalidates every browser subscription: each browser must press **Turn on** again.

## 3. Windows tray app

Install from the download page (or build `apps/desktop` with `pnpm tauri build` on Windows) and connect it from the
web app when it asks. It shows in _Your devices_ as "open now" while running.

## Alarms and hard notifications on Android

Alarms ring from the phone itself (scheduled locally, so they work offline) and from FCM. For them to ring on time:

- **Alarms & reminders** permission: Android settings → Apps → ORVYN → _Alarms & reminders_ → allowed.
- **Full-screen notifications** (Android 14+): Apps → ORVYN → _Notifications_ → allow full screen, so an alarm lights
  the screen over the lock screen.
- **Battery**: Apps → ORVYN → _Battery_ → _Unrestricted_ (Samsung/Xiaomi/Oppo also have "auto-start" / "sleeping apps"
  lists; take ORVYN out of them).
- **Sound**: the _Alarms_ notification channel uses the alarm volume, not the ringer.

The Android app shows these as a checklist in Settings → Notifications.
