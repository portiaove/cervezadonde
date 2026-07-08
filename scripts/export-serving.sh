#!/usr/bin/env bash
# Dump ONLY the serving tables from the local pipeline DB into a compressed
# custom-format archive to ship to the VPS. Run on the maintainer's PC after a
# weekly ingest. See docs/13-deploy.md for the restore side.
set -euo pipefail

SRC="${LOCAL_DATABASE_URL:-postgres://minimarket:minimarket@localhost:5432/minimarket}"
OUT="${1:-cervezadonde-serving.dump}"

pg_dump "$SRC" \
  --data-only --no-owner --no-privileges \
  -t stores -t store_activities \
  -Fc -f "$OUT"

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "next: scp it to the VPS and restore per docs/13-deploy.md"
