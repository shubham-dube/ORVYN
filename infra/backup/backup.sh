#!/bin/sh
# pg_dump (custom format) → age-encrypted with a public key → $BACKUP_TARGET (R2 via rclone, or a local path).
# The server can write backups but cannot read old ones without the identity file (kept for the restore test).
set -eu
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key)}"
: "${BACKUP_TARGET:?set BACKUP_TARGET}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="orvyn-${stamp}.dump.age"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pg_dump --format=custom --compress=6 --no-owner --no-privileges -f "$tmp/db.dump"
pg_restore --list "$tmp/db.dump" > /dev/null   # refuse to upload a dump that isn't readable
age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp/$name" "$tmp/db.dump"
rclone copyto --s3-no-check-bucket "$tmp/$name" "$BACKUP_TARGET/$name"
rclone delete --min-age "${KEEP_DAYS}d" --include 'orvyn-*.dump.age' "$BACKUP_TARGET"

size=$(wc -c < "$tmp/$name")
echo "backup ok: $name ($size bytes)"
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 "${BACKUP_HEARTBEAT_URL}?status=up&msg=${name}" > /dev/null || echo "warning: heartbeat ping failed"
fi
