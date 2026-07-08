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
# edit deploy/.env.prod: set a strong POSTGRES_PASSWORD, confirm SITE_ADDRESS
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

All heavy work stays on your PC. After a weekly ingest
(`pnpm worker:ingest:madrid` / `:osm` / future crawler):

```bash
# on your PC — dump only the serving tables
bash scripts/export-serving.sh            # -> cervezadonde-serving.dump
scp cervezadonde-serving.dump root@VPS_IP:/root/cervezadonde/
```

On the server, load it into the running Postgres (truncate + restore,
triggers disabled for the FK):

```bash
cd ~/cervezadonde
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T postgres psql -U cervezadonde -d cervezadonde \
  -c 'TRUNCATE store_activities, stores RESTART IDENTITY CASCADE;'

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T postgres pg_restore --data-only --disable-triggers --no-owner \
  -U cervezadonde -d cervezadonde < cervezadonde-serving.dump
```

The API serves the new data immediately (no restart needed). This whole step
can later become a one-line script or a Task Scheduler job on your PC.

## 3. Updating code

```bash
# on the server
cd ~/cervezadonde && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
# for web/UI changes, rebuild dist on your PC and re-scp to deploy/web-dist/
```

## Notes

- Port 5432 is bound to `127.0.0.1` only. To poke the prod DB from your PC,
  use an SSH tunnel: `ssh -L 5432:localhost:5432 root@VPS_IP`.
- The API runs under `tsx` (ADR-006). No build artifact to manage.
- Only `stores` + `store_activities` ship to prod; the raw OSM/web enrichment
  tables stay on your PC. Sequences drift harmlessly while the prod DB is
  read-only; reset them if/when user-write features land.
- Backups: the `pgdata` volume is the only durable state, and the weekly dump
  is itself a recovery point — keep the last few.
