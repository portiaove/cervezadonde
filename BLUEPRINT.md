# MiniMarket Madrid — Blueprint (beer-now pivot)

## 1. Executive summary

A Madrid-only mobile-first web map answering one question:
**"¿Dónde puedo conseguir una cerveza ahora mismo, cerca de mí?"** —
covering bars, supermarkets, alimentaciones, bodegas and 24h shops, with
opening hours and Madrid's municipal alcohol-sale ordinance taken into
account.

The MVP is Madrid-only. It does not try to be a full bar directory, a
Google Maps clone, or a perfect legal/commercial registry. Its first
goal is practical: open the web, see the nearest place that's open and
allowed to give you a beer right now, and walk there.

Built from open and owned data:

1. Ayuntamiento de Madrid Censo de Locales as the canonical baseline.
2. OpenStreetMap as a first-class source of opening hours (ADR-005).
3. User/community feedback as the long-term quality layer.
4. No scraping or bulk extraction from Google Maps (ADR-003).

## 2. MVP thesis

Finding beer in Madrid right now is harder than it should be:

- Google Maps doesn't filter by time of day usefully.
- Many small alimentaciones are inconsistently indexed.
- **Madrid's municipal ordinance forbids takeaway alcohol between 22:00
  and 09:00** — making half the "open now" results misleading at night.

The MVP solves this by combining Censo (what exists where) with OSM
(when it's open) and surfacing the ordinance as a first-class rule in
the API (ADR-004). Bars and shops live on the same map with different
intents: *para tomar* (consume here) and *para llevar* (takeaway).

## 3. Scope

### In scope for MVP

- Madrid city only.
- Web app, mobile-first.
- Map view with nearby beer sources.
- Search by current location.
- Filters: `Cerca de mí`, `Abre ahora`, `Para tomar`, `Para llevar`,
  `24h`, `Ocultar cadenas`.
- Place card with hours, intent, "puede vender cerveza ahora" line.
- Time chip with global "venta abierta / venta cerrada" state.
- User feedback (anonymous, moderated): wrong hours, closed, sells beer.
- Daily Censo ingest + weekly OSM ingest.
- Basic admin/moderation table.

### Out of scope for MVP

- Native mobile apps.
- Cities beyond Madrid.
- Beer prices, brand filters, reservations.
- Sunday/holiday calendar (v1.1).
- Gas stations (v2).
- Reviews/ratings as a social network.
- Scraping Google Maps.
- Guaranteeing opening hours are correct.
- Classifying by owner ethnicity (always out of scope, by principle).

## 4. Product language

The product is *functional*, not ethnic. We talk about:

- bar, cafetería
- supermercado
- alimentación, ultramarinos, mini-market
- bodega
- tienda 24h

Internal field name: `place_type`. Never `owner_origin`.

## 5. Core user journeys

### Journey 1 — Late-night beer

1. User opens the web at 23:14.
2. Map centres on user; time chip shows "23:14 · venta cerrada".
3. Only bars and 24h shops appear by default.
4. User taps the closest open bar and walks there.

### Journey 2 — Quick takeaway run

1. User at 21:30 wants a six-pack.
2. Map shows shops within 5 minutes, all open, all able to sell.
3. User picks the closest with cold beer.

### Journey 3 — Improve the map

1. User taps a place marked "horario no confirmado".
2. User reports "abierto hasta las 02:00".
3. Feedback enters moderation; if confirmed, hours update on the map.

## 6. Success criteria for MVP

- Madrid-wide map with thousands of beer-source markers.
- At 22:30 on a Friday: map shows mostly bars; shops marked
  "no puede vender ahora" with reason.
- At 13:00: shops and bars interleaved, mostly green.
- Top-3 nearby results for any random Madrid address are real, walkable,
  and accurately classified by intent.
- A user can correct an opening hour in under 15 seconds.

## 7. Repo structure

```
minimarket-madrid/
  README.md
  BLUEPRINT.md
  docs/
    01-product.md
    02-data-strategy.md
    03-architecture.md
    04-domain-model.md
    05-api-contract.md
    06-ingestion-pipeline.md
    07-scoring-classification.md
    08-ux-map-legend.md
    09-legal-data-governance.md
    10-delivery-plan.md
    11-runbook.md
  prompts/
    IMPLEMENTATION_BRIEF_FOR_AI.md
  decisions/
    ADR-001-stack.md
    ADR-002-data-sources.md
    ADR-003-no-google-scraping.md
    ADR-004-madrid-alcohol-ordinance.md
    ADR-005-osm-opening-hours.md
  apps/
    api/  web/  worker/
  packages/
    shared/  db/
```

## 8. Implementation stack

Pragmatic TypeScript:

- Web: Vite + React 18 + MapLibre GL JS.
- API: Node 20 + Fastify + Zod + postgres-js. Server-side open-now
  evaluator (ADR-004).
- Worker: Node 20 + TypeScript CLIs for Censo and OSM ingestion.
- DB: PostgreSQL 16 + PostGIS 3.4.
- Map base: OpenStreetMap raster tiles (free dev); vector tile provider
  in Phase 3.

No Kafka, no microservices, no event sourcing, no ML, no user accounts
beyond anti-spam.

## 9. First build sequence (history)

Phase 0 (done):
1. Monorepo + Docker Compose + PostGIS up.
2. Sample fixture ingest + nearest-store API + map UI.

Phase 1 (done before pivot):
3. Real Censo ingest with deterministic scorer v1.
4. Chain exclusion table.
5. Vitest unit tests.

Phase 1 (post-pivot, in flight — see `docs/10-delivery-plan.md`):
- M6a: doc rewrite + ADRs 004/005 (done).
- M6b: schema migration #5 (place_type, hours, OSM enrichment).
- M6c: scorer v2-beer.
- M6d: broaden Censo target epigraphs to include 561xxx (bars).
- M6e: open-now evaluator enforcing ADR-004.
- M6f: `/stores/nearby` v2 (place_type, intent, open_now, at_time).
- M6g: OSM enrichment worker (ADR-005).
- M6h: web UI v2 (time chip, intent filters, marker colours).

Phase 2: store detail page, feedback endpoint, moderation, admin token.

Phase 3: deployment, daily + weekly crons, attribution/about page,
public name decision.
