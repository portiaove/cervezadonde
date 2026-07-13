#!/usr/bin/env bash
# One command to refresh + check ALL analytics for cervezadonde.es (docs/15 §4).
# Run on the VPS:  bash scripts/analytics.sh
#
# It consolidates the whole picture:
#   1. ensures the free GeoIP DB (DB-IP Lite) exists,
#   2. regenerates the GoAccess HTML report — humans only (crawlers ignored),
#      IPs anonymised,
#   3. prints the "top searched areas" table (the censo signal) to the terminal.
#
# Requires goaccess + python3 on the host:  apt-get install -y goaccess
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/deploy/logs/caddy/access.log"
GEO="$ROOT/deploy/geoip/dbip-city-lite.mmdb"
OUT_DIR="$ROOT/deploy/web-analytics"
OUT="$OUT_DIR/report.html"

# `--archive` also freezes a dated monthly snapshot (run it from a monthly cron).
ARCHIVE=0
[ "${1:-}" = "--archive" ] && ARCHIVE=1

mkdir -p "$(dirname "$GEO")" "$OUT_DIR"

if [ ! -s "$LOG" ]; then
  echo "No access log at $LOG — is the Caddy logging deploy live, with some traffic?"
  exit 1
fi

# GeoIP DB (free DB-IP Lite, monthly). Fetched once; delete the file to refresh.
if [ ! -s "$GEO" ]; then
  MONTH="$(date +%Y-%m)"
  echo "Fetching GeoIP DB (dbip-city-lite-$MONTH)…"
  if ! curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$MONTH.mmdb.gz" | gunzip > "$GEO" 2>/dev/null; then
    echo "  (GeoIP fetch failed — geo panel will be empty; continuing)"
    rm -f "$GEO"
  fi
fi

geo_arg=()
[ -s "$GEO" ] && geo_arg=(--geoip-database="$GEO")

if goaccess "$LOG" --log-format=CADDY --anonymize-ip \
     --ignore-crawlers --unknowns-as-crawlers \
     "${geo_arg[@]}" -o "$OUT" 2>/dev/null; then
  echo "Full report refreshed → $OUT"
else
  echo "goaccess failed — is it installed?  apt-get install -y goaccess"
fi

echo
echo "===============  Top searched areas (your censo signal)  ==============="
python3 "$ROOT/scripts/top-areas.py" "$LOG"
echo "======================================================================="
echo
echo "Full report (visitors, geo, devices, referrers, errors):"
echo "  $OUT"
echo "  view:  scp root@cervezadonde.es:$OUT .    — or serve at /analytics (docs/15 §4)"

# Monthly archive: a frozen dated report + a growing top-areas history file, so
# you can look back at monthly metrics after raw logs have rolled off.
if [ "$ARCHIVE" = 1 ]; then
  ARCH="$OUT_DIR/archive"
  mkdir -p "$ARCH"
  MONTH="$(date +%Y-%m)"
  cp -f "$OUT" "$ARCH/report-$MONTH.html"
  python3 "$ROOT/scripts/top-areas.py" --tsv "$LOG" | while IFS=$'\t' read -r area hits; do
    printf '%s\t%s\t%s\n' "$MONTH" "$area" "$hits"
  done >> "$ARCH/areas-history.tsv"
  echo
  echo "Archived monthly snapshot → $ARCH/report-$MONTH.html (+ areas-history.tsv)"
fi
