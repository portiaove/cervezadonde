# MiniMarket Madrid (beer-now pivot)

Madrid-only mobile-first web map answering one question:
**"¿Dónde puedo conseguir una cerveza ahora mismo, cerca de mí?"**

Built on the Ayuntamiento de Madrid Censo de Locales + OpenStreetMap +
PostGIS + a deterministic scoring model. The product respects Madrid's
municipal ordinance forbidding takeaway alcohol between 22:00 and 09:00
([ADR-004](./decisions/ADR-004-madrid-alcohol-ordinance.md)).

No Google Maps scraping. See [`BLUEPRINT.md`](./BLUEPRINT.md), [`docs/`](./docs)
and [`decisions/`](./decisions/) for the full design. Package name remains
`cervezadonde` until the public name is chosen in Phase 3.

## Status

| Component | Status |
|---|---|
| Repo scaffolding + Docker Compose + git (`cervezadonde` repo) | done |
| PostGIS schema + migrations v1–v6 | done |
| `packages/shared` typed contract (Zod) | done |
| `chain_patterns` table | done — re-purposed as informational |
| Real Madrid Censo ingest (bars + shops, scorer v2-beer) | done — 16k stores |
| Vitest unit tests (scorer v1/v2, openNow, OSM matcher) | done — 102 tests |
| API `/health` + `/stores/nearby` + `/stores/map` (v2 filters) | done |
| **M6a — Pivot doc rewrite + ADRs 004/005** | done |
| **M6b — Schema migration #5 (place_type, hours, OSM enrichment)** | done |
| **M6c — Scorer v2-beer** | done |
| **M6d — Broaden Censo epigraph set (bars + shops)** | done |
| **M6e — Open-now evaluator + ADR-004 enforcement** | done |
| **M6f — `/stores/nearby` + `/stores/map` v2 (place_type, intent, open_now, at_time)** | done |
| **M6g — OSM enrichment worker (Overpass, batched match)** | done — 1.4k stores enriched |
| **M6h — Web UI v2 (time chip, intent legend, filters, nearest-open card)** | done |
| **Hours coverage** | ⚠️ ~9% (OSM only) — biggest open problem; evaluating richer sources (Overture, Foursquare OS, feedback) |
| Store detail page | Phase 2 |
| User feedback endpoint + moderation | Phase 2 |
| Deployment + scheduled crons | Phase 3 |

## Stack

| Layer | Tech |
|---|---|
| Web | Vite + React 18 + MapLibre GL JS |
| API | Node 20 + TypeScript + Fastify + Zod |
| Worker | Node 20 + TypeScript CLI (commander, csv-parse) |
| DB | PostgreSQL 16 + PostGIS 3.4 (Docker `postgis/postgis:16-3.4`) |
| Monorepo | pnpm workspaces |
| Lint/format | Biome |
| Tests | Vitest |

## Layout

```
apps/api          Fastify HTTP server (/health, /stores/nearby)
apps/web          Vite + React + MapLibre map UI
apps/worker       Ingestion CLI (ingest:sample, ingest:madrid, diagnose:madrid)
packages/shared   Shared TS types & Zod schemas
packages/db       node-pg-migrate migrations + postgres-js client
docs/             Product, architecture, scoring, governance, runbook
decisions/        ADRs (001-stack, 002-data-sources, 003-no-google,
                  004-alcohol-ordinance, 005-osm-opening-hours)
```

## Prerequisites

- Node.js >= 20.10
- pnpm >= 9 — install with `corepack enable; corepack prepare pnpm@9.12.0 --activate`
- Docker Desktop running

## Quickstart

### 1. One-time setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:up
pnpm db:migrate
```

### 2. See it work immediately (fixture, no network)

```powershell
pnpm worker:ingest:sample
pnpm api:dev               # terminal A — Fastify on :3001
pnpm web:dev               # terminal B — Vite on :5173
# open http://localhost:5173
```

Sample stores live under `source_name='madrid_sample_fixture'`. The
fixture rows are pre-pivot alimentaciones; M6 will swap them for a small
beer-source set.

### 3. Load the real Madrid Censo

```powershell
pnpm worker:ingest:madrid --limit 200    # first time
pnpm worker:ingest:madrid                # full ingest (~2–5 min cache-hit)
```

After M6d, the same command will also include bars (epigraph 561xxx).

## Command reference

| Command | What it does |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start / stop PostGIS container |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm worker:ingest:sample` | Load fixture (no network) |
| `pnpm worker:diagnose:madrid` | Download + report file shape, no DB writes |
| `pnpm worker:ingest:madrid [--limit N] [--fresh]` | Censo pipeline |
| `pnpm worker:ingest:osm` (M6g) | OSM enrichment pipeline |
| `pnpm api:dev` | Run API in watch mode on :3001 |
| `pnpm web:dev` | Run web app on :5173 |
| `pnpm test` | Run Vitest across all workspaces |
| `pnpm lint` / `pnpm format` | Biome |

## Pivot at a glance

The project pivoted from "find the nearest neighbourhood convenience shop"
to "find the nearest beer right now". What changed and what stayed:

- **Stays:** repo, PostGIS, Censo as canonical, no Google scraping,
  provenance layering, Vitest discipline, deployment shape.
- **Changes:** bars are first-class; chains are surfaced not excluded;
  OSM `opening_hours` is a Phase 1 must; the API computes "open now"
  honouring the 22:00 ordinance; UI gains time chip and intent filters.

See [`docs/01-product.md`](./docs/01-product.md) for the rewritten product
definition and [`docs/10-delivery-plan.md`](./docs/10-delivery-plan.md)
for the M6 plan.

## Source-name conventions

- `madrid_sample_fixture` — bundled fixture.
- `madrid_censo` — real Censo data.
- `osm_only` (M6g+) — OSM-only places without a Censo match.

Each source's ingest only soft-deactivates its own rows.

## Operations

See [`docs/11-runbook.md`](./docs/11-runbook.md) for daily refresh,
verification queries, troubleshooting, scorer rerun pattern, and OSM
ingest details.

## Project docs

- [`BLUEPRINT.md`](./BLUEPRINT.md) — original blueprint, updated for pivot
- [`docs/01-product.md`](./docs/01-product.md) — product definition (beer-now)
- [`docs/02-data-strategy.md`](./docs/02-data-strategy.md) — Censo + OSM
- [`docs/03-architecture.md`](./docs/03-architecture.md) — high-level architecture
- [`docs/04-domain-model.md`](./docs/04-domain-model.md) — entities, place_type, hours
- [`docs/05-api-contract.md`](./docs/05-api-contract.md) — `/stores/nearby` v2 shape
- [`docs/06-ingestion-pipeline.md`](./docs/06-ingestion-pipeline.md) — Censo + OSM
- [`docs/07-scoring-classification.md`](./docs/07-scoring-classification.md) — scorer v2-beer
- [`docs/08-ux-map-legend.md`](./docs/08-ux-map-legend.md) — UI, time chip, intent filters
- [`docs/09-legal-data-governance.md`](./docs/09-legal-data-governance.md) — Madrid + OSM + ordinance
- [`docs/10-delivery-plan.md`](./docs/10-delivery-plan.md) — M6 plan
- [`docs/11-runbook.md`](./docs/11-runbook.md) — operations runbook
- [`decisions/ADR-001-stack.md`](./decisions/ADR-001-stack.md)
- [`decisions/ADR-002-data-sources.md`](./decisions/ADR-002-data-sources.md)
- [`decisions/ADR-003-no-google-scraping.md`](./decisions/ADR-003-no-google-scraping.md)
- [`decisions/ADR-004-madrid-alcohol-ordinance.md`](./decisions/ADR-004-madrid-alcohol-ordinance.md)
- [`decisions/ADR-005-osm-opening-hours.md`](./decisions/ADR-005-osm-opening-hours.md)

## Attribution

Contiene información reutilizada del Portal de Datos Abiertos del Ayuntamiento
de Madrid. Datos de horarios y enriquecimiento © OpenStreetMap contributors.
Mapa base © OpenStreetMap contributors.

La Ordenanza Municipal de Madrid no permite la venta de alcohol para llevar
entre las 22:00 y las 09:00. La aplicación marca los establecimientos como
"no pueden vender ahora" durante esa franja.
