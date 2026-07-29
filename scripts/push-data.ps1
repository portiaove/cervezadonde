# One-command data refresh: dump serving data locally -> upload -> restore on VPS.
# Run on your PC (PowerShell) after a weekly ingest:  .\scripts\push-data.ps1
param(
  [string]$VpsHost   = "root@cervezadonde.es",
  [string]$Container = "minimarket-postgres",
  [string]$DbUser    = "minimarket",
  [string]$DbName    = "minimarket"
)
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DumpPath = Join-Path $RepoRoot "serving.dump"

function Assert-NativeSuccess([string]$Operation, [int]$ExitCode) {
  if ($ExitCode -ne 0) {
    throw "$Operation failed (exit $ExitCode)"
  }
}

Write-Host "1/3  Dumping serving data from local DB ($Container)..." -ForegroundColor Cyan
docker exec $Container pg_dump -U $DbUser -d $DbName --data-only --no-owner `
  -t import_runs -t stores -t store_activities -Fc -f /tmp/serving.dump
Assert-NativeSuccess "Local pg_dump" $LASTEXITCODE

docker cp "${Container}:/tmp/serving.dump" $DumpPath
Assert-NativeSuccess "Copying the local dump out of Docker" $LASTEXITCODE

Write-Host "2/3  Uploading dump to VPS..." -ForegroundColor Cyan
scp $DumpPath "${VpsHost}:/root/cervezadonde/serving.dump"
Assert-NativeSuccess "Uploading the serving dump" $LASTEXITCODE

Write-Host "3/3  Restoring on VPS..." -ForegroundColor Cyan
ssh $VpsHost "bash /root/cervezadonde/deploy/restore-data.sh"
Assert-NativeSuccess "Production restore" $LASTEXITCODE

Remove-Item -LiteralPath $DumpPath
Write-Host "Data pushed to production." -ForegroundColor Green
