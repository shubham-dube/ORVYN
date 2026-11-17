# Run ORVYN on your own PC (Windows first)

Everything runs on your machine: Postgres + Valkey (Redis) in Docker, the API on :4000, the web app on :3000, and
the Android app on an emulator or your phone over USB.

## 1. Install once

```powershell
winget install --id=OpenJS.NodeJS.LTS -e        # Node 22+
winget install --id=Docker.DockerDesktop -e     # then start Docker Desktop once
winget install --id=Git.Git -e
npm install -g pnpm@10
```

For the Android app also: `winget install --id=Google.AndroidStudio -e` (open it once to install the Android SDK)
and Flutter 3.50 (<https://docs.flutter.dev/get-started/install/windows/mobile>), then `flutter doctor`.

## 2. Get the code and configure

```powershell
git clone https://github.com/shubham-dube/ORVYN.git
cd ORVYN
pnpm install
pnpm setup:local you@your-email.com     # writes .env: you become the owner, fresh secrets, web-push keys
pnpm db:up                              # Postgres + Valkey in Docker
pnpm build                              # first build of the shared packages
```

`.env` is git-ignored. Everything in it is optional except what `setup:local` filled in.

## 3. Start

```powershell
pnpm dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000/health> should say `"status":"ok"`.

## 4. Sign in (no email service needed locally)

1. Open <http://localhost:3000>, enter **the email you gave `setup:local`**, press _Email me a code_.
2. Without a Resend key, mail is not sent: the code appears in the `pnpm dev` console as
   `[dev outbox] to=you@… subject="123456 is your ORVYN code"`, or open
   `http://localhost:4000/dev/mailbox?email=you@your-email.com`.
3. Type the code. That first sign-in makes you the **owner** (all modules, the People page).
4. **Add a passkey**: Settings → Security → _Add passkey_ (Windows Hello / phone). Next time use _Sign in with passkey_.
5. **Notifications**: Settings → Notifications → _Turn on_, then _Send a test_. Browser push works on localhost.

### Invite a friend (locally)

People → Invites → choose modules → _Create invite link_. They open the link (on your PC, or on your network if you
share it), enter their email, and read the code the same way (console / dev mailbox). Each friend only sees the
modules you switched on; you can change that live.

### Google sign-in (optional)

Create an OAuth client (Google Cloud Console → Credentials → Web application, redirect URI
`http://localhost:4000/auth/google/callback`), put `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET` and the same
id in `GOOGLE_CLIENT_IDS` in `.env`, and start the web app with `NEXT_PUBLIC_GOOGLE_ENABLED=1`.

### Google Calendar (optional)

Use the same OAuth web client. In Google Cloud Console enable the **Google Calendar API**, add the redirect URI
`http://localhost:4000/calendar/google/callback`, and add the scopes `calendar.events` and
`calendar.calendarlist.readonly` on the consent screen (while the app is in "Testing", add each Google account you
want to connect as a test user). Then Settings → Calendars → _Connect a Google account_ — repeat for every account.
Changes arrive within 5 minutes locally (Google can only push changes instantly to a public https address, so in
production they arrive within seconds). `CALENDAR_TOKEN_KEY` is optional locally.

### Real emails (optional)

Add `RESEND_API_KEY` and a `MAIL_FROM` on a domain verified in Resend.

## 5. Android app

With the API running (`pnpm dev`):

```powershell
cd apps/mobile
flutter pub get
# emulator (Android Studio → Device Manager → start one):
flutter run --dart-define=ORVYN_API_URL=http://10.0.2.2:4000
# or your phone over USB (enable Developer options → USB debugging):
adb reverse tcp:4000 tcp:4000
flutter run --dart-define=ORVYN_API_URL=http://localhost:4000
```

Sign in with the same email and code. Debug builds may use plain HTTP only to the emulator host and `localhost`.
Push notifications while the app is closed need the Firebase config (release step, see `apps/mobile/README.md`);
locally they arrive while the app is open.

## 6. Chrome extension

```powershell
pnpm --filter @orvyn/extension build:dev
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist/development`. Click the
ORVYN icon → **Connect to ORVYN** → approve. (If your `.env` predates this, add
`EXTENSION_IDS=hapijaoahockgcidibcnbghpajpnnanh` and restart `pnpm dev`.)

## 7. Windows tray app

Needs Rust (`winget install Rustlang.Rustup`). With `pnpm dev` running:

```powershell
pnpm --filter @orvyn/desktop desktop:dev
```

The ORVYN orb appears in the tray → _Connect to ORVYN…_ → approve in the browser. Toasts arrive with Open / Dismiss.
Installer: `pnpm --filter @orvyn/desktop desktop:build` (or download **orvyn-windows** from a CI run).

## 8. Everyday commands

| Command                        | What                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `pnpm dev`                     | API + web with reload                                                 |
| `pnpm db:up` / `pnpm db:down`  | start / stop the databases (data is kept in Docker volumes)           |
| `pnpm test`                    | all tests (uses the `orvyn_test` database: create it once, see below) |
| `pnpm --filter @orvyn/web e2e` | browser end-to-end tests                                              |

Create the test databases once:

```powershell
docker exec -it orvyn-dev-postgres-1 psql -U orvyn -d orvyn_dev -c "create database orvyn_test" -c "create database orvyn_e2e"
```

## Troubleshooting

| Symptom                                      | Fix                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| API exits with `ECONNREFUSED 127.0.0.1:5432` | `pnpm db:up` (and make sure Docker Desktop is running)                                          |
| `Too many attempts` when asking for a code   | wait 15 minutes, or raise `AUTH_CODE_LIMIT` in `.env` for local use                             |
| Web says "Something went wrong" on sign-in   | the API isn't running on :4000 — check the `pnpm dev` console                                   |
| Port 5432 already used                       | another Postgres is installed; stop it or change the port in `infra/compose.dev.yml` and `.env` |
