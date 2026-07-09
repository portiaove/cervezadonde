#!/usr/bin/env bash
# Restore the serving tables on the VPS from a dump uploaded to the repo root.
# Called by scripts/push-data.ps1 over SSH. Run on the VPS.
set -euo pipefail

# Move to the repo root regardless of where we're called from.
cd "$(dirname "$0")/.."

DUMP="${1:-serving.dump}"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"

echo "Truncating serving tables…"
$COMPOSE exec -T postgres psql -U cervezadonde -d cervezadonde \
  -c 'TRUNCATE store_activities, stores RESTART IDENTITY CASCADE;'

echo "Restoring $DUMP…"
$COMPOSE exec -T postgres pg_restore --data-only --disable-triggers --no-owner \
  -U cervezadonde -d cervezadonde < "$DUMP"

$COMPOSE exec -T postgres psql -U cervezadonde -d cervezadonde \
  -c 'SELECT count(*) AS stores FROM stores;'

echo "Data refresh done."
