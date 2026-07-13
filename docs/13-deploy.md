# 13 — Deploy runbook (single VPS)

Implements ADR-006: pipeline on the maintainer's PC, service on one small VPS
(PostGIS + Fastify API + Caddy). Assets live in `deploy/`.

## 0. One-time: domain + server

1. Buy the domain (`cervezadonde.es`).
2. Create a VPS — e.g. **Hetzner CX22** (2 vCPU / 4 GB, ~4 €/mo), Ubuntu 24.04.
3. DNS: `A` record `@` → VPS IP, and `A` record `www` → VPS IP.
4. On the server, install Docker + compose plugin and open the firewall:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
   ```

## 1. One-time: first deploy

On the server:

```bash
git clone https://github.com/portiaove/cervezadonde.git
cd cervezadonde
cp deploy/.env.prod.example deploy/.env.prod
# edit deploy/.env.prod: set POSTGRES_PASSWORD to `openssl rand -hex 24`
# (hex, URL-safe — base64's / + = chars break the postgres:// URL), confirm
# SITE_ADDRESS
```

Build the web app **on your PC** (same-origin API path) and upload it:

```bash
# on your PC, in the repo:
VITE_API_URL=/api pnpm --filter @cervezadonde/web build
scp -r apps/web/dist/* root@VPS_IP:/root/cervezadonde/deploy/web-dist/
```

Bring the stack up (on the server):

```bash
cd ~/cervezadonde
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

Run migrations once the DB is healthy:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec api pnpm --filter @cervezadonde/db migrate up
```

Caddy obtains the TLS cert automatically once DNS resolves to the box. Check:

```bash
curl -s https://cervezadonde.es/api/health   # -> {"ok":true}
```

## 2. Weekly: refresh the data (the routine)

All heavy work stays on your PC. The whole routine is **one script**:

```powershell
.\scripts\refresh-all.ps1
```

It runs the pipeline in the correct order — Madrid + Barcelona censos, then
all-Spain OSM (which re-applies the censo enrichment), then the website hours
crawl — and finally pushes the serving tables to the VPS. Every run appends a
row to `logs\refresh-history.csv` (start, end, duration, status, counts) and a
full transcript to `logs\refresh-*.log`. Flags: `-NoPush` (rebuild locally
only), `-SkipCrawl`, `-NoFreshPbf` (reuse the cached 1.4 GB Geofabrik extract).

Schedule it weekly with **Windows Task Scheduler** — runs only when you're
logged on, and catches up on the next login if the PC was off:

```powershell
$action   = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\juanp\Dev\cervezadonde.es\scripts\refresh-all.ps1"'
$trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "03:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "cervezadonde-refresh" -Action $action -Trigger $trigger -Settings $settings
```

Prereqs for the unattended run: Docker Desktop running, and SSH to the VPS
working with no passphrase prompt (key in the Windows OpenSSH agent).

The API serves the new data immediately (no restart needed). Confirm freshness
any time — from the phone even — at `https://cervezadonde.es/api/meta`, which
returns `data_updated_at` + store counts.

To ship data **without** re-running the pipeline (e.g. after a manual ingest),
use `.\scripts\push-data.ps1` (dump serving tables → scp → restore on the VPS).

## 3. Updating code

```bash
# on the server
cd ~/cervezadonde && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
# for web/UI changes, rebuild dist on your PC and re-scp to deploy/web-dist/
```

## Automation

Two flows, deliberately separate (ADR-006): **code** deploys from GitHub,
**data** is pushed from your PC.

### Code — GitHub Actions (`.github/workflows/deploy.yml`)

Every push to `main` builds the web and redeploys (web build + `git pull` +
`docker compose up -d --build`). One-time setup — two repo secrets:

- `DEPLOY_SSH_KEY` — a private key whose public half is in the VPS
  `~/.ssh/authorized_keys` (use a dedicated deploy key, no passphrase).
- `DEPLOY_HOST` — the VPS IP.

### Data — one command from your PC

```powershell
.\scripts\refresh-all.ps1      # full pipeline + push   (see §2, scheduled weekly)
.\scripts\push-data.ps1        # push only: dump serving tables -> upload -> restore
```

`push-data.ps1` calls `deploy/restore-data.sh` on the VPS (truncate +
`pg_restore` + count). `refresh-all.ps1` wraps the whole ingest then calls it.
Both are scheduled/documented in §2.

## Notes

- Port 5432 is bound to `127.0.0.1` only. To poke the prod DB from your PC,
  use an SSH tunnel: `ssh -L 5432:localhost:5432 root@VPS_IP`.
- The API runs under `tsx` (ADR-006). No build artifact to manage.
- Only `stores` + `store_activities` ship to prod; the raw OSM/web enrichment
  tables stay on your PC. Sequences drift harmlessly while the prod DB is
  read-only; reset them if/when user-write features land.
- Backups: the `pgdata` volume is the only durable state, and the weekly dump
  is itself a recovery point — keep the last few.
