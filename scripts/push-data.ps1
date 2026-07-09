# One-command data refresh: dump serving tables locally -> upload -> restore on VPS.
# Run on your PC (PowerShell) after a weekly ingest:  .\scripts\push-data.ps1
param(
  [string]$VpsHost   = "root@178.104.48.240",
  [string]$Container = "minimarket-postgres",
  [string]$DbUser    = "minimarket",
  [string]$DbName    = "minimarket"
)
$ErrorActionPreference = "Stop"

Write-Host "1/3  Dumping serving tables from local DB ($Container)…" -ForegroundColor Cyan
docker exec $Container pg_dump -U $DbUser -d $DbName --data-only --no-owner `
  -t stores -t store_activities -Fc -f /tmp/serving.dump
docker cp "${Container}:/tmp/serving.dump" serving.dump

Write-Host "2/3  Uploading dump to VPS…" -ForegroundColor Cyan
scp serving.dump "${VpsHost}:/root/cervezadonde/serving.dump"

Write-Host "3/3  Restoring on VPS…" -ForegroundColor Cyan
ssh $VpsHost "bash /root/cervezadonde/deploy/restore-data.sh"

Remove-Item serving.dump
Write-Host "Data pushed to production." -ForegroundColor Green
