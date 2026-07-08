# ADR-001 — Stack Choice

## Decision

Use a pragmatic TypeScript monorepo:

- React web app.
- Node.js TypeScript API.
- Node.js TypeScript ingestion worker.
- PostgreSQL + PostGIS.
- MapLibre GL JS or Leaflet.

## Rationale

The MVP is data + map + simple APIs. TypeScript keeps frontend, backend and worker aligned. PostGIS is the correct tool for distance and map-bound queries.

## Consequences

- Team can move quickly with one language.
- Geospatial logic remains in the database.
- Avoids early platform complexity.
