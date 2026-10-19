#!/usr/bin/env bash
# Production-owned evidence is NOT part of the PC's serving snapshot.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs/backups
target="logs/backups/quality-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T postgres pg_dump -U cervezadonde -d cervezadonde --no-owner \
  -t place_reports -t place_corrections -Fc > "$target"
test -s "$target"
echo "Evidence backup retained: $target"
