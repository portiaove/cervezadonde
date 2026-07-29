#!/usr/bin/env bash
# Restore the serving data on the VPS from a dump uploaded to the repo root.
# Called by scripts/push-data.ps1 over SSH. Run on the VPS.
set -euo pipefail

# Move to the repo root regardless of where we're called from.
cd "$(dirname "$0")/.."

DUMP="${1:-serving.dump}"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"
RESTORE_SQL="$(mktemp)"
trap 'rm -f "$RESTORE_SQL"' EXIT

echo "Validating $DUMP..."
$COMPOSE exec -T postgres pg_restore --data-only --disable-triggers --no-owner \
  --exit-on-error --file=- < "$DUMP" > "$RESTORE_SQL"

echo "Replacing serving data atomically..."
{
  cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
TRUNCATE public.store_activities, public.stores, public.import_runs
  RESTART IDENTITY CASCADE;
SQL
  cat "$RESTORE_SQL"
  cat <<'SQL'
DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stores s
    LEFT JOIN public.import_runs r ON r.id = s.last_import_run_id
    WHERE s.last_import_run_id IS NOT NULL
      AND r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'restored stores contain orphaned last_import_run_id values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.store_activities a
    LEFT JOIN public.stores s ON s.id = a.store_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'restored store_activities contain orphaned store_id values';
  END IF;
END
$validation$;
COMMIT;
SQL
} | $COMPOSE exec -T postgres psql -U cervezadonde -d cervezadonde

$COMPOSE exec -T postgres psql -U cervezadonde -d cervezadonde \
  -c 'SELECT
        (SELECT count(*) FROM import_runs) AS import_runs,
        (SELECT count(*) FROM stores) AS stores,
        (SELECT count(*) FROM store_activities) AS store_activities;'

echo "Data refresh done."
