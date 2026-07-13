# One-command weekly data refresh for cervezadonde.es. Runs the full local
# pipeline (every official censo + all-Spain OSM + website hours crawl) and,
# unless -NoPush, ships the serving tables to production. Designed to run
# unattended via Windows Task Scheduler, but safe to run by hand.
#
#   .\scripts\refresh-all.ps1              # full run + push to prod
#   .\scripts\refresh-all.ps1 -NoPush      # rebuild local data only (dry run, no deploy)
#   .\scripts\refresh-all.ps1 -SkipCrawl   # skip the slow, low-yield website hours crawl
#   .\scripts\refresh-all.ps1 -NoFreshPbf  # reuse the cached Geofabrik extract (no 1.4 GB re-download)
#
# Pipeline order matters: the censos ingest FIRST (they re-score/reactivate
# their rows), then the all-Spain OSM ingest runs LAST because it re-applies the
# censo enrichment (persistOsmCanonical -> enrichWithCenso) on top of the fresh
# censo state. See docs/14-roadmap.md and ADR-007.
#
# Prereqs for an UNATTENDED run:
#   - Docker Desktop running   (the local PostGIS container + osmium both need the engine)
#   - SSH to root@cervezadonde.es must work with NO passphrase prompt
#     (key loaded in the Windows OpenSSH agent, or a passphrase-less deploy key)
#
# Every run appends one row to logs\refresh-history.csv and writes a full
# transcript to logs\refresh-<timestamp>.log (both git-ignored).

param(
  [switch]$NoPush,
  [switch]$SkipCrawl,
  [switch]$NoFreshPbf
)
$ErrorActionPreference = "Stop"

# --- locate repo + set up logging -----------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$Log     = Join-Path $LogDir "refresh-$stamp.log"
$History = Join-Path $LogDir "refresh-history.csv"
Start-Transcript -Path $Log | Out-Null

$startedAt = Get-Date
$status    = "ok"
$pushed    = "no"

# Run a named step; a non-zero exit from the native command aborts the run.
function Step($name, [scriptblock]$cmd) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  $t0 = Get-Date
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
  Write-Host ("--- {0} OK ({1:n0}s)" -f $name, ((Get-Date) - $t0).TotalSeconds) -ForegroundColor Green
}

# Best-effort store counts from the local DB for the ledger. Never fails the run.
# Docker Desktop on Windows prints a benign "failed to get console mode for
# stdout" line when its output is captured, so pick only the numeric "n,n" line.
function Get-Counts {
  try {
    $q = "SELECT count(*), count(*) FILTER (WHERE opening_hours_osm IS NOT NULL OR opening_hours_web IS NOT NULL) FROM stores WHERE confidence_level <> 'excluded'"
    $raw  = docker exec minimarket-postgres psql -U minimarket -d minimarket -tAF',' -c $q
    $line = $raw | Where-Object { $_ -match '^\s*\d+,\d+\s*$' } | Select-Object -First 1
    if ($line) { return ($line.Trim() -split ',') }
  } catch {}
  return @("n/a", "n/a")
}

try {
  Step "0/5 Ensure local PostGIS is up" { pnpm db:up }
  Step "1/5 Madrid censo"               { pnpm worker:ingest:madrid }
  Step "2/5 Barcelona censo"            { pnpm worker:ingest:barcelona }
  if ($NoFreshPbf) {
    Step "3/5 OSM Spain + censo enrichment" { pnpm worker:ingest:osm:pbf -r spain }
  } else {
    Step "3/5 OSM Spain + censo enrichment (fresh extract)" { pnpm worker:ingest:osm:pbf -r spain --fresh }
  }
  if ($SkipCrawl) {
    Write-Host "`n=== 4/5 Website hours crawl SKIPPED (-SkipCrawl) ===" -ForegroundColor Yellow
  } else {
    Step "4/5 Website hours crawl" { pnpm worker:crawl:hours }
  }
  if ($NoPush) {
    Write-Host "`n=== 5/5 Push to prod SKIPPED (-NoPush) ===" -ForegroundColor Yellow
  } else {
    Step "5/5 Push serving tables to prod" { & (Join-Path $PSScriptRoot "push-data.ps1") }
    $pushed = "yes"
  }
}
catch {
  $status = "FAILED: $($_.Exception.Message)"
  Write-Host "`n$status" -ForegroundColor Red
}
finally {
  $endedAt = Get-Date
  $inv     = [System.Globalization.CultureInfo]::InvariantCulture
  # Format the duration with an explicit '.' — a Spanish locale would otherwise
  # render "6,5" and shift every CSV column.
  $durStr  = ([math]::Round(($endedAt - $startedAt).TotalMinutes, 1)).ToString($inv)
  $counts  = Get-Counts
  # commas/newlines in the status would break the CSV columns
  $safeStatus = ($status -replace '[,\r\n]', ';')
  if (-not (Test-Path $History)) {
    "started_at,ended_at,duration_min,status,pushed,active_stores,stores_with_hours" |
      Out-File -FilePath $History -Encoding utf8
  }
  # Join pre-stringified fields so no culture-sensitive formatting sneaks in.
  $row = @(
    $startedAt.ToString('yyyy-MM-dd HH:mm')
    $endedAt.ToString('yyyy-MM-dd HH:mm')
    $durStr
    $safeStatus
    $pushed
    $counts[0]
    $counts[1]
  ) -join ','
  $row | Out-File -FilePath $History -Append -Encoding utf8
  Stop-Transcript | Out-Null
  Write-Host "`nRun logged to $History"
  Write-Host "Full transcript: $Log"
  if ($status -ne "ok") { exit 1 }
}
