# cervezadonde.es

Mobile-first web map that answers one question, fast:
**"¿Dónde está la cerveza abierta más cercana, ahora mismo?"**

Every place carries an **intent** — **barra** (para tomar: bar, cafetería,
restaurante) or **lata** (para llevar: súper, alimentación, bodega, 24h) —
and the app respects opening hours and Madrid's municipal ordinance forbidding
takeaway alcohol between 22:00 and 09:00
([ADR-004](./decisions/ADR-004-madrid-alcohol-ordinance.md)).

Built on OpenStreetMap (national POI base) enriched with official municipal
censos (Madrid, Barcelona) + PostGIS + a deterministic scoring model.
**No Google Maps** ([ADR-003](./decisions/ADR-003-no-google-scraping.md)).

**Live, Spain-wide:** deployed at [cervezadonde.es](https://cervezadonde.es) on
a single VPS (PostGIS + API + Caddy). The data pipeline runs locally and ships
finished serving tables to production — see
[ADR-006](./decisions/ADR-006-deployment.md),
[ADR-007](./decisions/ADR-007-national-osm-primary.md), and
[`docs/13-deploy.md`](./docs/13-deploy.md).

## Status

**The app is built and live end-to-end across Spain:** ~177k stores classified
by `place_type` + intent, the open-now evaluator honouring the 22:00 ordinance,
`/stores/map` + `/stores/clusters` + `/stores/nearby` with filters, the OSM +
censo + website-hours pipeline, and the web UI (time chip, lata/barra legend,
intent filters, nearest-open card, street search). 142 Vitest cases green.

| Area | State |
|---|---|
| Data model, ingestion, scoring, API, web UI | done |
| Spain-wide coverage (OSM national base + Madrid/Barcelona censos) | done |
| Deployment (VPS) + one-command weekly refresh (`refresh-all.ps1`) + CI deploy | done |
| **Opening-hours coverage** | ⚠️ ~13% (OSM + website crawl + estimated defaults) — the biggest open problem; see [`docs/12-hours-data-sources.md`](./docs/12-hours-data-sources.md) |
| Community feedback loop for hours (contribute back to OSM) | next |
| More city censos (Valencia, Zaragoza, …), store detail page | later |

## Stack

| Layer | Tech |
|---|---|
| Web | Vite + React 18 + MapLibre GL JS |
| API | Node 22 + TypeScript + Fastify + Zod |
| Worker | Node 22 + TypeScript CLI (commander, csv-parse) |
| DB | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) |
| Monorepo | pnpm workspaces |
| Proxy / TLS | Caddy (auto-HTTPS) |
| Lint/format | Biome · Tests: Vitest |

## Layout

```
apps/api          Fastify HTTP server (/health, /meta, /stores/{nearby,map,clusters})
apps/web          Vite + React + MapLibre map UI
apps/worker       Ingestion CLI (ingest:madrid, ingest:barcelona, ingest:osm:pbf, crawl:hours, …)
packages/shared   Shared TS types & Zod schemas
packages/db       node-pg-migrate migrations + postgres-js client
deploy/           Production stack (Dockerfile.api, docker-compose.prod.yml, Caddyfile)
scripts/          Weekly refresh (refresh-all.ps1) + data push (push-data.ps1) + dump helper
docs/             Product, architecture, scoring, governance, runbook, deploy, roadmap
decisions/        ADRs (001–007)
```

## Prerequisites

- Node.js 22 (>= 20.10)
- pnpm >= 9 — `corepack enable; corepack prepare pnpm@9.12.0 --activate`
- Docker Desktop running

## Quickstart (local dev)

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:up
pnpm db:migrate
```

See it work with the bundled fixture (no network):

```powershell
pnpm worker:ingest:sample
pnpm api:dev               # terminal A — Fastify on :3001
pnpm web:dev               # terminal B — Vite on :5173
# open http://localhost:5173
```

Load real data (OSM national base + official censos):

```powershell
pnpm worker:ingest:madrid                # Madrid Censo (official enrichment)
pnpm worker:ingest:barcelona             # Barcelona city Censo (official enrichment)
pnpm worker:ingest:diba                   # Barcelona province Censo / GIA (official enrichment)
pnpm worker:ingest:osm:pbf -r spain      # OSM canonical, all of Spain (via osmium)
pnpm worker:crawl:hours                  # website schema.org opening hours (incremental)
```

Or run the whole weekly pipeline (all of the above) with one command — see
[the refresh section](#deploy) and `scripts/refresh-all.ps1`.

## Command reference

| Command | What it does |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start / stop PostGIS container |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm worker:ingest:sample` | Load fixture (no network) |
| `pnpm worker:ingest:madrid [--limit N] [--fresh]` | Madrid Censo (official enrichment) |
| `pnpm worker:ingest:barcelona [--fresh]` | Barcelona city Censo (official enrichment) |
| `pnpm worker:ingest:diba [--fresh]` | Barcelona province Censo / GIA, 184 municipalities (official enrichment) |
| `pnpm worker:ingest:osm:pbf [-r region] [--fresh]` | OSM-canonical ingest from a Geofabrik pbf via osmium (national base, ADR-007) |
| `pnpm worker:crawl:hours [-l N]` | Crawl business websites for schema.org opening hours (incremental) |
| `pnpm worker:diagnose:madrid` | Report source-file shape, no DB writes |
| `pnpm api:dev` / `pnpm web:dev` | Run API (:3001) / web (:5173) |
| `pnpm test` | Vitest across all workspaces |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | tsc / Biome |
| `.\scripts\refresh-all.ps1` | **Weekly**: run the whole pipeline + push to prod (Task Scheduler) |
| `.\scripts\push-data.ps1` | Dump serving tables and refresh production only |

## Deploy

Code deploys from GitHub Actions on every push to `main`. Data is refreshed
weekly from your PC with `.\scripts\refresh-all.ps1` (runs the whole pipeline
then pushes to the VPS), scheduled via Windows Task Scheduler; `push-data.ps1`
ships data only. `GET /api/meta` reports the live dataset's `data_updated_at`.
Full walkthrough (provisioning, DNS, first deploy, weekly refresh) in
[`docs/13-deploy.md`](./docs/13-deploy.md).

## Operations

Everything you run to keep it alive, in one place (detail in
[`docs/13-deploy.md`](./docs/13-deploy.md) + [`docs/15-observability.md`](./docs/15-observability.md)):

| Task | Command | Where |
|---|---|---|
| Weekly data refresh + push to prod | `.\scripts\refresh-all.ps1` (Task Scheduler) | PC |
| Push data only (no re-ingest) | `.\scripts\push-data.ps1` | PC |
| Deploy code | `git push origin main` (GitHub Actions) | PC |
| Check live data freshness | `curl https://cervezadonde.es/api/meta` | anywhere |
| View analytics (report + searched areas) | `bash scripts/analytics.sh` | VPS |
| Searched-areas table only | `python3 scripts/top-areas.py` | VPS |
| Archive a monthly analytics snapshot | `bash scripts/analytics.sh --archive` (monthly cron) | VPS |
| Uptime alerts | UptimeRobot → `/` + `/api/health` | external |
| Disaster recovery (rebuild) | see [`docs/15`](./docs/15-observability.md) §5 | — |

## Source-name conventions

- `osm` — OpenStreetMap canonical stores (the national base, ADR-007).
- `censo_madrid` / `censo_barcelona` / `censo_diba` — official municipal/provincial
  censos; matched OSM stores are flagged `oficial` and their duplicates hidden
  (`excluded`). `censo_diba` is the Barcelona province GIA (184 municipalities).
- `madrid_sample_fixture` — bundled fixture (offline dev).

Each source's ingest only soft-deactivates its own rows.

## Project docs

- [`docs/00-overview.md`](./docs/00-overview.md) — **architecture overview (start here, with diagrams)**
- [`BLUEPRINT.md`](./BLUEPRINT.md) — product blueprint
- [`docs/01-product.md`](./docs/01-product.md) — product definition
- [`docs/02-data-strategy.md`](./docs/02-data-strategy.md) — Censo + OSM
- [`docs/03-architecture.md`](./docs/03-architecture.md) — architecture
- [`docs/04-domain-model.md`](./docs/04-domain-model.md) — entities, place_type, hours
- [`docs/05-api-contract.md`](./docs/05-api-contract.md) — API shapes
- [`docs/06-ingestion-pipeline.md`](./docs/06-ingestion-pipeline.md) — Censo + OSM
- [`docs/07-scoring-classification.md`](./docs/07-scoring-classification.md) — scorer
- [`docs/08-ux-map-legend.md`](./docs/08-ux-map-legend.md) — UI, time chip, intent filters
- [`docs/09-legal-data-governance.md`](./docs/09-legal-data-governance.md) — Madrid + OSM + ordinance
- [`docs/10-delivery-plan.md`](./docs/10-delivery-plan.md) — delivery plan
- [`docs/11-runbook.md`](./docs/11-runbook.md) — operations runbook
- [`docs/12-hours-data-sources.md`](./docs/12-hours-data-sources.md) — where to get more opening hours
- [`docs/13-deploy.md`](./docs/13-deploy.md) — deploy runbook (single VPS)
- [`docs/14-roadmap.md`](./docs/14-roadmap.md) — next steps / handoff (UX, censos, ops, hours)
- [`docs/15-observability.md`](./docs/15-observability.md) — ops: log rotation, uptime, analytics, recovery
- [`decisions/`](./decisions/) — ADR-001…007

## Attribution

Locales y horarios © OpenStreetMap contributors (base nacional). Enriquecido con
datos oficiales del Portal de Datos Abiertos del Ayuntamiento de Madrid, del
Cens d'activitats econòmiques en planta baixa (Open Data BCN, CC BY 4.0) y del
Cens municipal d'activitats i establiments (GIA) de la Diputació de Barcelona
(CC BY 4.0). Mapa base © OpenStreetMap contributors, © CARTO.

La Ordenanza Municipal de Madrid no permite la venta de alcohol para llevar
entre las 22:00 y las 09:00. La aplicación marca los establecimientos como
"no pueden vender ahora" durante esa franja.
