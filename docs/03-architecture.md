# 03 — Architecture

## Architecture goal

Build a simple, robust MVP that can ingest Madrid Censo daily, enrich it
with OpenStreetMap weekly, expose fast nearby + open-now queries, and
render a good mobile web map.

## High-level architecture

```txt
Madrid Open Data        OpenStreetMap (Overpass)
       |                          |
       v                          v
 Censo Ingestion Worker     OSM Enrichment Worker
       |                          |
       +----------+---------------+
                  v
        PostgreSQL + PostGIS
        ┌──────────────────────────────┐
        │ stores                       │
        │ store_activities             │
        │ store_osm_enrichment         │
        │ store_hours_overrides (v1.1) │
        │ store_feedback               │
        │ chain_patterns               │
        │ import_runs                  │
        └──────────────────────────────┘
                  |
                  v
        REST API + Open-Now evaluator (Europe/Madrid + ADR-004)
                  |
                  v
        Mobile-first Web Map (MapLibre + OSM tiles)
                  |
                  v
        Feedback API → moderation tables
```

## Components

### Web app

- Render map (MapLibre GL JS).
- Request geolocation.
- Show nearby places filtered by the user's intent (para tomar / para llevar)
  and the current time.
- Apply filters (open_now, 24h, place_type, ocultar cadenas).
- Show place detail card.
- Submit feedback.

### API

- `/stores/nearby` — PostGIS query + open-now evaluator.
- `/stores/map` — viewport query for clustering.
- `/stores/:id` — full detail with provenance.
- `/stores/:id/feedback` — POST anonymous correction.
- Admin endpoints behind a token.

The **open-now evaluator** is a small server-side module that, given
the current Europe/Madrid time, the place's `place_type`, and its
`opening_hours_osm`, returns `{ open, sellsBeerNow, reason }`. Enforces the
Madrid alcohol ordinance (ADR-004).

Stack: Node 20 + TypeScript + Fastify + Zod + postgres-js.

### Censo Ingestion Worker

- Download Madrid Censo (cached).
- COPY into staging.
- Aggregate by `id_local`, filter to target epigraphs (doc 02).
- Score via `scoring/v2.ts`.
- Upsert into `stores` under `source_name='censo_madrid'`.
- Soft-deactivate previously-seen-but-missing rows.

### OSM Enrichment Worker

- Periodic Overpass query for Madrid bbox + relevant shop/amenity tags.
- Cache the raw JSON response.
- Match each OSM node/way to a `stores` row by spatial proximity
  (≤ 25 m) and name similarity.
- Upsert into `store_osm_enrichment`. Do not write to `stores`.

### Database

- PostgreSQL 16 + PostGIS 3.4.
- GIST index on `stores.geom`.
- `opening_hours_osm` lives on `stores` (denormalised from
  `store_osm_enrichment` for query speed), but the canonical OSM row stays
  in the enrichment table for licensing traceability.

## Deployment model

### Local

Docker Compose: `postgres`, `api`, `web`, workers as one-off CLIs.

### Production MVP (Phase 3)

- Managed Postgres with PostGIS.
- One service for API+web (or two if needed).
- Both workers scheduled on platform cron (Censo daily 04:00, OSM weekly).
- Source URLs in env vars.

## Avoided complexity

No Kafka, no event sourcing, no microservices, no ML, no user accounts
beyond anti-spam, no websockets. The open-now evaluation is a function,
not a service.
