# cervezadonde.es

Mobile-first web map that answers one question, fast:
**"¿Dónde está la cerveza abierta más cercana, ahora mismo?"**

Every place carries an **intent** — **barra** (para tomar: bar, cafetería,
restaurante) or **lata** (para llevar: súper, alimentación, bodega, 24h) —
and the app respects opening hours and Madrid's municipal ordinance forbidding
takeaway alcohol between 22:00 and 09:00
([ADR-004](./decisions/ADR-004-madrid-alcohol-ordinance.md)).

Built on the Ayuntamiento de Madrid Censo de Locales + OpenStreetMap + PostGIS
+ a deterministic scoring model. **No Google Maps** ([ADR-003](./decisions/ADR-003-no-google-scraping.md)).

**Live:** deployed at [cervezadonde.es](https://cervezadonde.es) on a single
VPS (PostGIS + API + Caddy). The data pipeline runs locally and ships finished
serving tables to production — see [ADR-006](./decisions/ADR-006-deployment.md)
and [`docs/13-deploy.md`](./docs/13-deploy.md).

Madrid today; Spain-wide is the next scope step.

## Status

**The app is built and live end-to-end:** ~16k Madrid stores classified by
`place_type` + intent, the open-now evaluator honouring the 22:00 ordinance,
`/stores/map` + `/stores/nearby` with filters, the OSM hours-enrichment worker,
and the web UI (time chip, lata/barra legend, intent filters, nearest-open
card). 102 Vitest cases green.

| Area | State |
|---|---|
| Data model, ingestion, scoring, API, web UI | done |
| Deployment (VPS) + one-command data refresh + CI deploy | done |
| **Opening-hours coverage** | ⚠️ ~9% (OSM only) — the biggest open problem; see [`docs/12-hours-data-sources.md`](./docs/12-hours-data-sources.md) |
| Richer hours (website `schema.org` crawl, defaults, feedback) | next |
| Spain-wide coverage (OSM as the national POI base) | next |
| Store detail page, user feedback + moderation | later |

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
apps/api          Fastify HTTP server (/health, /stores/nearby, /stores/map)
apps/web          Vite + React + MapLibre map UI
apps/worker       Ingestion CLI (ingest:madrid, ingest:osm, ingest:sample, diagnose:madrid)
packages/shared   Shared TS types & Zod schemas
packages/db       node-pg-migrate migrations + postgres-js client
deploy/           Production stack (Dockerfile.api, docker-compose.prod.yml, Caddyfile)
scripts/          Data push (push-data.ps1) + dump helper
docs/             Product, architecture, scoring, governance, runbook, deploy
decisions/        ADRs (001–006)
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

Load real Madrid data:

```powershell
pnpm worker:ingest:madrid --limit 200    # first time, quick
pnpm worker:ingest:madrid                # full Censo (bars + shops)
pnpm worker:ingest:osm --fresh           # OSM opening-hours enrichment
```

## Command reference

| Command | What it does |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start / stop PostGIS container |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm worker:ingest:sample` | Load fixture (no network) |
| `pnpm worker:ingest:madrid [--limit N] [--fresh]` | Censo pipeline |
| `pnpm worker:ingest:osm [--fresh] [-l N]` | OSM opening-hours enrichment (onto Censo stores) |
| `pnpm worker:ingest:osm:pbf [-r region] [--fresh]` | OSM-canonical ingest from a Geofabrik pbf via osmium (national path, ADR-007) |
| `pnpm worker:diagnose:madrid` | Report source-file shape, no DB writes |
| `pnpm api:dev` / `pnpm web:dev` | Run API (:3001) / web (:5173) |
| `pnpm test` | Vitest across all workspaces |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | tsc / Biome |
| `.\scripts\push-data.ps1` | Dump serving tables and refresh production |

## Deploy

Code deploys from GitHub Actions on every push to `main`; data is pushed
PC → VPS with `.\scripts\push-data.ps1`. Full walkthrough (provisioning, DNS,
first deploy, weekly refresh) in [`docs/13-deploy.md`](./docs/13-deploy.md).

## Source-name conventions

- `madrid_censo` — real Censo data (canonical).
- `madrid_sample_fixture` — bundled fixture.
- `osm_only` — OSM-only places without a Censo match (parked for review).

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
- [`decisions/`](./decisions/) — ADR-001…006

## Attribution

Contiene información reutilizada del Portal de Datos Abiertos del Ayuntamiento
de Madrid. Datos de horarios y enriquecimiento © OpenStreetMap contributors.
Mapa base © OpenStreetMap contributors.

La Ordenanza Municipal de Madrid no permite la venta de alcohol para llevar
entre las 22:00 y las 09:00. La aplicación marca los establecimientos como
"no pueden vender ahora" durante esa franja.
