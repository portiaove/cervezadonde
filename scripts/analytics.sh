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

# Dashboard index: searched-areas table + links to the full GoAccess report and
# the monthly archive — so /analytics is one place with everything.
{
  echo '<!doctype html><html lang="es"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1">'
  echo '<title>cervezadonde.es · analítica</title>'
  echo '<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#222}h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:2rem}table{border-collapse:collapse;width:100%}th,td{padding:.35rem .7rem;text-align:left;border-bottom:1px solid #e5e5e5}td+td,th+th{text-align:right}a{color:#c25e00}small{color:#888}</style>'
  echo '</head><body>'
  echo '<h1>cervezadonde.es — analítica</h1>'
  echo "<small>Actualizado: $(date '+%Y-%m-%d %H:%M %Z')</small>"
  echo '<h2>Zonas más buscadas</h2>'
  python3 "$ROOT/scripts/top-areas.py" --html "$LOG"
  echo '<h2>Actividad por día</h2>'
  echo '<p><small>Visitantes distintos y zona más buscada, por día.</small></p>'
  python3 "$ROOT/scripts/top-areas.py" --daily --html "$LOG"
  echo '<h2>Informe completo</h2>'
  echo '<p><a href="/analytics/report.html">GoAccess — visitas, geolocalización, dispositivos, referrers, errores →</a></p>'
  echo '<h2>Histórico mensual</h2><ul>'
  for f in "$OUT_DIR"/archive/report-*.html; do
    [ -e "$f" ] && echo "<li><a href=\"/analytics/archive/$(basename "$f")\">$(basename "$f")</a></li>"
  done
  echo '</ul>'
  [ -e "$OUT_DIR/archive/areas-history.tsv" ] &&
    echo '<p><a href="/analytics/archive/areas-history.tsv">areas-history.tsv — zonas por mes</a></p>'
  echo '</body></html>'
} > "$OUT_DIR/index.html"

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
