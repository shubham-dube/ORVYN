#!/bin/sh
# Boots infra/docker-compose.yml (minus the tunnel) and checks it the way the internet would reach it.
# Builds the images (unless SKIP_BUILD=1), so it is the whole deploy path minus the tunnel.
set -eu
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'docker compose $FILES down -v > /dev/null 2>&1 || true; rm -rf "$work"' EXIT

age-keygen -o "$work/id.txt" 2> "$work/pub.txt"
mkdir -p secrets && cp "$work/id.txt" secrets/backup-identity.txt
cat > "$work/.env" << ENV
DOMAIN=orvyn.test
OWNER_EMAIL=owner@example.test
POSTGRES_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -base64 48)
TOKEN_PEPPER=$(openssl rand -base64 48)
RESEND_API_KEY=re_ci_placeholder
MAIL_FROM=ORVYN <orvyn@example.test>
CLOUDFLARE_TUNNEL_TOKEN=unused
BACKUP_AGE_RECIPIENT=$(grep -o 'age1[0-9a-z]*' "$work/pub.txt")
GLITCHTIP_SECRET_KEY=$(openssl rand -hex 32)
RELEASE=latest
ENV
FILES="-p orvyn-smoke -f docker-compose.yml -f test/compose.ci.yml --env-file $work/.env"
C="docker compose $FILES"

[ "${SKIP_BUILD:-0}" = 1 ] || $C build api web backup

$C up -d postgres valkey
$C --profile tools run --rm migrate
$C --profile tools run --rm glitchtip-migrate > /dev/null
$C up -d

check() { # host path expected-status
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://localhost:8088$2" || true)
    [ "$code" = "$3" ] && { echo "ok  $1$2 → $code"; return 0; }
    sleep 2
  done
  echo "FAIL $1$2 → $code (wanted $3)"; $C logs --tail 50; exit 1
}
check orvyn.test /sign-in 200
check api.orvyn.test /health 200
check orvyn.test /.well-known/assetlinks.json 200
check status.orvyn.test / 302
check errors.orvyn.test / 200
check api.orvyn.test /dev/mailbox 404   # dev-only route is absent in production

# the API sees Cloudflare's client IP, never a spoofed X-Forwarded-For
curl -s -o /dev/null -H 'Host: api.orvyn.test' -H 'CF-Connecting-IP: 203.0.113.7' -H 'X-Forwarded-For: 6.6.6.6' \
  "http://localhost:8088/health"
seen=$($C logs api 2>&1 | grep -c '6\.6\.6\.6' || true)
[ "$seen" = 0 ] || { echo "FAIL spoofed IP reached the API logs"; exit 1; }

# backups: a user exists, then backup → restore test → wrong key / tampered must fail
$C exec -T postgres psql -U orvyn -d orvyn -q -c \
  "insert into users (id, email, name, role) values (gen_random_uuid(), 'owner@example.test', 'Owner', 'owner')"
$C run --rm --entrypoint sh backup /t/backup-roundtrip.sh
echo "stack smoke: all checks passed"
