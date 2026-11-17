# Deploy ORVYN (Hetzner + Cloudflare, ≈ €9/month)

What you end up with: `https://orvyn.dubey.app` (web/PWA), `https://api.orvyn.dubey.app`, a status page at
`status.orvyn.dubey.app`, error tracking at `errors.orvyn.dubey.app`, nightly encrypted backups in Cloudflare R2 with
a weekly automatic restore test, and alerts to your email. Design: [ADR-0009](../adr/0009-deployment-and-operations.md).

Time: about an hour the first time. You need: a Hetzner account, the `dubey.app` zone on Cloudflare, Resend (already
used by JobOS), and an SSH key on your PC (`ssh-keygen -t ed25519`).

## 1. Server

1. Hetzner Cloud → new project → **Add server**: location _Falkenstein/Nuremberg_ (or Singapore for lower latency
   from India), image **Ubuntu 24.04**, type **CAX21** (ARM, 4 vCPU, 8 GB), add your SSH key, enable **Backups**.
2. Hetzner → Firewalls → create one allowing only **TCP 22** inbound; attach it to the server.
3. From your PC:
   ```bash
   ssh root@<server-ip> 'curl -fsSL https://raw.githubusercontent.com/shubham-dube/ORVYN/main/infra/provision.sh -o provision.sh && sh provision.sh https://github.com/shubham-dube/ORVYN.git'
   ```
   If the repo is private, first add a read-only **deploy key**: on the server `ssh-keygen -t ed25519` as `deploy`,
   paste the public key in GitHub → repo → Settings → Deploy keys, and use the `git@github.com:…` URL.

From now on log in as `deploy` (`ssh deploy@<server-ip>`); root login and passwords are switched off.

## 2. Cloudflare Tunnel (no open ports)

Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared) → name `orvyn` →
copy the **token** from the Docker command. Then **Public hostnames** → add four, all pointing to
**HTTP `caddy:80`**:

| Hostname                 | Service           |
| ------------------------ | ----------------- |
| `orvyn.dubey.app`        | `http://caddy:80` |
| `api.orvyn.dubey.app`    | `http://caddy:80` |
| `status.orvyn.dubey.app` | `http://caddy:80` |
| `errors.orvyn.dubey.app` | `http://caddy:80` |

Optional but recommended: Zero Trust → Access → protect `status.` and `errors.` with your email (free).

## 3. Backups storage (R2) and the backup key

1. Cloudflare → **R2** → create bucket `orvyn-backups`. R2 → _Manage API tokens_ → create a token with
   **Object Read & Write** on that bucket only. Note the access key id, secret and the S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
2. On the server (as `deploy`):
   ```bash
   age-keygen -o /opt/orvyn/infra/secrets/backup-identity.txt && chmod 600 /opt/orvyn/infra/secrets/backup-identity.txt
   ```
   It prints `Public key: age1…` — that goes in `.env` below. **Copy the whole identity file into your password
   manager now.** Without it no backup can ever be read.

## 4. Settings

```bash
cd /opt/orvyn/infra && cp .env.production.example .env && chmod 600 .env && nano .env
```

Fill: `OWNER_EMAIL`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `TOKEN_PEPPER`, `GLITCHTIP_SECRET_KEY` (each
`openssl rand -base64 48`), `RESEND_API_KEY`, `MAIL_FROM`, `CLOUDFLARE_TUNNEL_TOKEN`, the `R2_*` values,
`BACKUP_AGE_RECIPIENT` (the `age1…` key), and VAPID keys (`npx web-push generate-vapid-keys` on your PC).
Leave `SENTRY_DSN`, `*_HEARTBEAT_URL` empty for now.

Google sign-in and Google Calendar (optional): in the OAuth client add the redirect URIs
`https://api.orvyn.dubey.app/auth/google/callback` and `https://api.orvyn.dubey.app/calendar/google/callback`, enable
the Google Calendar API, add the `calendar.events` and `calendar.calendarlist.readonly` scopes to the consent screen,
then fill `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET`, `GOOGLE_CLIENT_IDS` and `CALENDAR_TOKEN_KEY`
(`openssl rand -base64 32`; keep a copy with the backup key — without it, connected accounts must be reconnected).
Google pushes calendar changes to `https://api.orvyn.dubey.app/calendar/google/webhook` through the tunnel; nothing
else to open.

## 5. First deploy

```bash
/opt/orvyn/infra/deploy.sh
```

It builds on the server, migrates, starts everything, waits until healthy (and rolls back if not). Then open
`https://orvyn.dubey.app`, sign in with `OWNER_EMAIL` — the code arrives by email — and add a passkey.

## 6. Monitoring (10 minutes)

**Uptime Kuma** (`https://status.orvyn.dubey.app`): create the admin account, then _Settings → Notifications_ →
SMTP via Resend (host `smtp.resend.com`, port 587, user `resend`, password = your Resend key) or Telegram. Add monitors:

- HTTP `https://api.orvyn.dubey.app/health` (keyword `"status":"ok"`), and `https://orvyn.dubey.app/sign-in`.
- **Push** monitor "Backup" (heartbeat interval 25 h) and "Restore test" (interval 8 days). Copy each push URL into
  `BACKUP_HEARTBEAT_URL` / `RESTORE_HEARTBEAT_URL` in `.env`.

**GlitchTip** (`https://errors.orvyn.dubey.app`): set `GLITCHTIP_REGISTRATION=true`, run `deploy.sh`, create your
account + organisation + a project "api", copy its **DSN** into `SENTRY_DSN`, set `GLITCHTIP_REGISTRATION=false`,
and run `deploy.sh` again. Turn on email alerts for the project.

Prove the backup chain once: `docker compose -f infra/docker-compose.yml --env-file infra/.env exec backup backup.sh`
then `… exec backup restore-test.sh` — both should print `ok`, and both Kuma push monitors turn green.

## 7. Updates

```bash
ssh deploy@<server-ip> /opt/orvyn/infra/deploy.sh            # latest main
ssh deploy@<server-ip> /opt/orvyn/infra/deploy.sh 7365f5f    # a specific revision (also how you roll back)
```

## 8. Android against production

The APK from CI already points at `https://api.orvyn.dubey.app`. For invite links to open the app, put your signing
certificate's SHA-256 in `infra/well-known/assetlinks.json` (Play Console → _App integrity_ → _App signing key
certificate_, or `keytool -list -v -keystore upload.jks` before Play), commit, deploy.

## Restore after a disaster

1. New server: steps 1–4 (same `.env`, same `backup-identity.txt` from your password manager).
2. `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d postgres`
3. Download and restore the newest backup:
   ```bash
   cd /opt/orvyn && C="docker compose -f infra/docker-compose.yml --env-file infra/.env"
   $C run --rm backup sh -c 'f=$(rclone lsf "$BACKUP_TARGET" | sort | tail -1); rclone copyto "$BACKUP_TARGET/$f" /tmp/b.age && age -d -i /run/secrets/backup-identity.txt /tmp/b.age | pg_restore --clean --if-exists --no-owner -d orvyn'
   ```
4. `infra/deploy.sh`. Everyone's devices reconnect on their own; Vault contents were ciphertext all along.

## Costs

CAX21 ≈ €6.5 + Hetzner backups ≈ €1.3 + IPv4 ≈ €0.6. Cloudflare (DNS, Tunnel, R2 up to 10 GB, Access up to 50 users)
and Resend's free tier: €0. AI usage is separate and capped per person.
