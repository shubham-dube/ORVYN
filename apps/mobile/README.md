# ORVYN for Android (Flutter)

Flutter 3.50 · Riverpod · go_router · drift (SQLite) · dio · web_socket_channel · FCM + local notifications ·
local_auth. Android first; iPhone uses the PWA until there is an Apple developer account (docs/DECISIONS.md).

## Layout

| Path | What |
| --- | --- |
| `lib/design/` | Aurora Glass for Flutter: `tokens.g.dart` (generated from `packages/design-tokens`, do not edit), theme + phase engine, aurora, glass, Orb, controls, toasts |
| `lib/core/` | API client (in-memory access token, refresh token in Keystore-backed storage, single-flight refresh), realtime socket, HLC, push parsing, models |
| `lib/sync/` | Offline-first sync: local mirror + outbox in SQLite, push/pull, pending edits stay on top of server data |
| `lib/app/` | State (session, notifications, light, app lock), router, app shell |
| `lib/features/` | Screens: sign-in / join, home, settings, notifications + command sheets, gallery |

## Run

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=ORVYN_API_URL=http://10.0.2.2:4000   # emulator → API on your machine
```

Debug builds allow plain HTTP only to `10.0.2.2`/`localhost`; release builds are HTTPS-only.

## Test

```bash
flutter analyze
flutter test                                                     # unit + widget (whole app over a fake API/socket)
ORVYN_LIVE_API=http://localhost:4100 flutter test --tags live    # Dart client against a real API (see apps/web/e2e/start-api.mjs)
```

After changing `lib/sync/db.dart`: `dart run build_runner build` (generated files are committed; CI checks).

## Release (later, when you're ready for the Play Store)

1. Create an upload key and `android/key.properties` (git-ignored):
   `storeFile=/path/upload.jks`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…`.
2. Add the Firebase config `android/app/google-services.json` (git-ignored) for push; the API needs
   `FCM_SERVICE_ACCOUNT_B64`. Without it the app works and notifications arrive while it is open.
3. Publish `https://orvyn.dubey.app/.well-known/assetlinks.json` with the app's signing-cert SHA-256 so invite links
   open the app (and, later, passkeys work on Android).
4. `flutter build appbundle --dart-define=ORVYN_API_URL=https://api.orvyn.dubey.app --dart-define=ORVYN_WEB_URL=https://orvyn.dubey.app`

CI builds a release APK (debug-signed) on every push: download it from the run's `orvyn-android` artifact.
