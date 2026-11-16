#!/bin/sh
# Proves the newest backup restores: download → decrypt → restore into a scratch database → sanity checks → drop.
# Success pings RESTORE_HEARTBEAT_URL; any failure means no ping, so Uptime Kuma alerts.
set -eu
: "${BACKUP_TARGET:?set BACKUP_TARGET}"
IDENTITY="${BACKUP_IDENTITY_FILE:-/run/secrets/backup-identity.txt}"
SCRATCH=orvyn_restore_test
tmp=$(mktemp -d)
cleanup() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" > /dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

latest=$(rclone lsf --include 'orvyn-*.dump.age' "$BACKUP_TARGET" | sort | tail -n 1)
[ -n "$latest" ] || { echo "restore test: no backups found"; exit 1; }
rclone copyto "$BACKUP_TARGET/$latest" "$tmp/b.age"
age -d -i "$IDENTITY" -o "$tmp/db.dump" "$tmp/b.age"

psql -q -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" "$tmp/db.dump"

q() { psql -tA -d "$1" -c "$2"; }
users=$(q "$SCRATCH" "select count(*) from users")
mig_backup=$(q "$SCRATCH" "select count(*) from drizzle.__drizzle_migrations")
mig_live=$(q "${PGDATABASE:-orvyn}" "select count(*) from drizzle.__drizzle_migrations")
[ "$users" -ge 1 ] || { echo "restore test: no users in backup"; exit 1; }
[ "$mig_backup" -ge 1 ] || { echo "restore test: no migrations in backup"; exit 1; }
# a backup older than the newest migration is still valid; one with *more* migrations than live is not ours
[ "$mig_backup" -le "$mig_live" ] || { echo "restore test: backup is ahead of live schema"; exit 1; }
age_h=$(( ( $(date -u +%s) - $(date -u -d "$(echo "$latest" | sed -E 's/orvyn-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2}).*/\1-\2-\3 \4:\5/')" +%s) ) / 3600 ))
[ "$age_h" -le 48 ] || { echo "restore test: newest backup is ${age_h}h old"; exit 1; }

echo "restore test ok: $latest users=$users migrations=$mig_backup age=${age_h}h"
if [ -n "${RESTORE_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 "${RESTORE_HEARTBEAT_URL}?status=up&msg=${latest}" > /dev/null || echo "warning: heartbeat ping failed"
fi
