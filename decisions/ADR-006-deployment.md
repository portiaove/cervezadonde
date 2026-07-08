# ADR-006 — Deployment: single small VPS + local batch pipeline

## Status

Accepted — 2026-07-08.

## Context

cervezadonde.es is a hobby project with no revenue (for now). It must be
cheap to run, and the ambition is **Spain-wide**, not just Madrid — an
estimated 300k–600k beer sources (bars, cafeterías, supermercados,
alimentaciones, bodegas, estancos, gasolineras).

Two workloads with opposite needs:

- **Pipeline** (Censo/OSM ingest, future website hours crawler): heavy,
  batch, weekly, not user-facing.
- **Service** (map + "nearest open beer right now"): always-on, read-mostly,
  but the core query is spatial **and** time-dependent.

## Decision

**Run the pipeline locally; serve from one small VPS with PostGIS.**

- **Pipeline runs on the maintainer's PC**, weekly (manual or Windows Task
  Scheduler). It produces the finished serving tables. No cloud compute is
  spent on the slow/tedious crawl+match work.
- **Service = a single ~4 €/mo VPS** (e.g. Hetzner CX22) running the existing
  `docker-compose` stack: PostgreSQL+PostGIS, the Fastify API, and Caddy as
  the TLS-terminating reverse proxy serving the built web app.
- **Data ships as a `pg_dump` of the serving tables only** (`stores`,
  `store_activities`, migrations) from PC → VPS weekly. The raw
  `store_osm_enrichment` / future `store_web_enrichment` tables stay local
  (pipeline-internal), keeping the upload small (~tens of MB compressed).

### Why VPS over static/PMTiles at Spain scale

The product's core question — *"la cerveza abierta más cercana ahora"* — is a
spatial + temporal query. PostGIS answers it in one indexed query anywhere in
Spain, regardless of dataset size. A fully static (PMTiles) site scales for
*rendering* the map but degrades exactly this query when the user is away
from a dense, already-loaded viewport, and needs a frontend rewrite. 0.5–1M
rows is trivial for PostGIS on a 4 GB box. Zero refactor: it is the same
stack we already run locally.

### Runtime note

The API's workspace deps (`@cervezadonde/db`, `@cervezadonde/shared`) are
source-only TS (`main: src/index.ts`), so `node dist/server.js` won't run
standalone. Production runs the API under **tsx** (same as dev, minus watch).
Simple and adequate for this scale; revisit with a bundler only if startup
cost ever matters.

## Topology

```
                 cervezadonde.es (DNS → VPS)
                          │  :443 (Caddy, auto-HTTPS)
        ┌─────────────────┴─────────────────┐
        │  /api/*  →  Fastify API (:3001)    │  (same origin, no CORS)
        │  /*      →  static web build (/srv)│
        └─────────────────┬─────────────────┘
                          │
                 PostgreSQL + PostGIS (internal only)
                          ▲
              weekly pg_dump restore  │
                          │
                 Maintainer's PC (pipeline: Censo/OSM/crawler)
```

Same-origin routing (`/api/*` stripped to the API) avoids CORS entirely; the
web is built with `VITE_API_URL=/api`.

## Consequences

- ~60 €/yr all-in (VPS ~48 € + `.es` domain ~10–15 €). Pipeline compute: 0 €.
- **National data-source shift:** the Madrid Censo is Madrid-only. Spain-wide,
  the primary "what places exist" source becomes **OSM** (nationwide, open),
  optionally widened by Overture / Foursquare-OS (both open, nationwide) for
  contact info and coverage. Hours strategy is unchanged (see ADR-005 +
  docs/12): OSM hours + website crawl + community feedback.
- User feedback writes (Phase 2) land naturally on the VPS DB later — no
  architecture change needed, unlike the static path.
- The VPS is a stateful box to keep patched/backed up. Postgres volume is the
  only durable state; the weekly restore is itself a recovery path.
- Deploy assets live in `deploy/` (Caddyfile, `docker-compose.prod.yml`,
  `Dockerfile.api`) and the runbook in `docs/13-deploy.md`.

## Alternatives considered

- **Static + PMTiles (0 €):** cheapest, but weak for time-based "open now /
  nearest" at national scale and a frontend rewrite. Kept as a fallback if the
  VPS ever becomes a burden.
- **Managed free (Supabase/Neon + serverless):** free-tier limits + cold
  starts + more moving parts; worst-of-both for this shape.
