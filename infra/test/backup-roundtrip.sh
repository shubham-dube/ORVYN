#!/bin/sh
# CI + local: backup → restore test must pass; a tampered file and a wrong key must fail.
# Needs: pg_dump/pg_restore/psql 16, age, rclone; PG* env pointing at a database with the ORVYN schema and a user.
set -eu
here=${BACKUP_SCRIPTS:-$(cd "$(dirname "$0")/../backup" && pwd)}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/target"
age-keygen -o "$work/id.txt" 2> "$work/pub.txt"
export BACKUP_AGE_RECIPIENT
BACKUP_AGE_RECIPIENT=$(grep -o 'age1[0-9a-z]*' "$work/pub.txt")
export BACKUP_TARGET="$work/target" BACKUP_IDENTITY_FILE="$work/id.txt" RCLONE_CONFIG=/dev/null

sh "$here/backup.sh"
sh "$here/restore-test.sh"
echo "PASS: backup restores"

f=$(ls "$work/target"/orvyn-*.dump.age)
if grep -q "users" "$f"; then echo "FAIL: backup is not encrypted"; exit 1; fi
echo "PASS: backup is encrypted"

age-keygen -o "$work/other.txt" 2> /dev/null
if BACKUP_IDENTITY_FILE="$work/other.txt" sh "$here/restore-test.sh" 2> /dev/null; then
  echo "FAIL: wrong key restored"; exit 1
fi
echo "PASS: wrong key refused"

printf 'garbage' >> "$f"
if sh "$here/restore-test.sh" 2> /dev/null; then echo "FAIL: tampered backup restored"; exit 1; fi
echo "PASS: tampered backup refused"
