#!/bin/sh
# Deploy a git revision. On the server (as deploy):   infra/deploy.sh [revision]     (default: origin/main)
# From your PC:  ssh deploy@<server> /opt/orvyn/infra/deploy.sh [revision]
# Builds on the server (native ARM), migrates, swaps containers, waits for health, rolls back on failure.
set -eu
cd "$(dirname "$0")/.."
REV="${1:-origin/main}"
COMPOSE="docker compose -f infra/docker-compose.yml --env-file infra/.env"

[ -f infra/.env ] || { echo "infra/.env missing (see infra/.env.production.example)"; exit 1; }
[ -f infra/secrets/backup-identity.txt ] || { echo "infra/secrets/backup-identity.txt missing (age private key)"; exit 1; }

previous=$(git rev-parse --short HEAD)
git fetch --quiet origin
git checkout --quiet --detach "$REV"
RELEASE=$(git rev-parse --short HEAD)
export RELEASE
echo "deploying $RELEASE (was $previous)"

$COMPOSE build --pull api web backup
$COMPOSE up -d postgres valkey
$COMPOSE --profile tools run --rm migrate
$COMPOSE --profile tools run --rm glitchtip-migrate
$COMPOSE up -d --remove-orphans

# wait for the API and web to report healthy; roll back if they don't
ok=0
for _ in $(seq 1 40); do
  api=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q api)" 2>/dev/null || echo none)
  web=$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q web)" 2>/dev/null || echo none)
  if [ "$api" = healthy ] && [ "$web" = healthy ]; then ok=1; break; fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  echo "health check failed (api=$api web=$web) — rolling back to $previous"
  git checkout --quiet --detach "$previous"
  RELEASE=$previous $COMPOSE up -d --remove-orphans
  exit 1
fi
docker image prune -f > /dev/null
echo "deployed $RELEASE"
