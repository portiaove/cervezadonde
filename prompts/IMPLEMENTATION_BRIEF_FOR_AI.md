# Implementation Brief for Codex / Claude Code

You are implementing the MVP for the project currently packaged as
`minimarket-madrid`, but whose product question is:

> "¿Dónde puedo conseguir una cerveza ahora mismo, cerca de mí?" (Madrid only)

Read the documentation in this order:

1. `README.md`
2. `BLUEPRINT.md`
3. `docs/01-product.md`
4. `docs/02-data-strategy.md`
5. `docs/03-architecture.md`
6. `docs/04-domain-model.md`
7. `docs/07-scoring-classification.md`
8. `docs/06-ingestion-pipeline.md`
9. `docs/05-api-contract.md`
10. `docs/08-ux-map-legend.md`
11. `docs/09-legal-data-governance.md`
12. `docs/10-delivery-plan.md`
13. `docs/11-runbook.md`
14. ADRs in order: 001 → 005

## Mission

Build a Madrid-only mobile-first web map that surfaces bars, supermarkets,
alimentaciones, bodegas and 24h shops where the user can get a beer right
now, with the Madrid alcohol-sale ordinance (ADR-004) honoured by the
"open now" evaluator.

## Important constraints

- Do not scrape Google Maps (ADR-003).
- Madrid Censo is the canonical baseline; OSM is a first-class hours
  source (ADR-005).
- Keep Censo, OSM, inferred, community and admin layers separable in
  storage. Never overwrite official columns with derived data.
- The 22:00–09:00 takeaway alcohol prohibition lives in one place
  (`apps/api/src/openNow.ts`), is fully unit-tested, and surfaces as a
  reason string in API responses.
- Functional categories only. Never label by ethnicity. The field is
  `place_type`.
- Chains are surfaced, not excluded. `is_chain` is informational.
- Keep the architecture small. No Kafka, no microservices, no ML.

## Current state (as of this brief)

- Repo scaffolding, PostGIS, sample fixture, real Censo ingest, scoring
  v1, /stores/nearby v1, MapLibre map: **done** (pre-pivot product framing
  still in code).
- Doc pivot + ADRs 004/005: **done**.
- Code pivot (M6b–M6h): **next**. See `docs/10-delivery-plan.md`.

## Next concrete tasks (M6, in order)

1. **M6b — Migration #5**. Add to `stores`: `place_type` enum,
   `sells_takeaway_beer` bool, `sells_onsite_beer` bool, `opening_hours_osm`
   text, `last_seen_osm_at` timestamptz. Add new table
   `store_osm_enrichment` (see doc 04).
2. **M6c — Scorer v2-beer**. New file `apps/worker/src/scoring/v2.ts`
   implementing the algorithm in doc 07. `SCORING_VERSION='v2-beer'`.
   Keep v1 around for one release for traceability.
3. **M6d — Broaden Censo target epigraphs**. Update
   `apps/worker/src/scoring/epigraphs.ts` to include 561001/2/4/5 (bars).
   Re-run `ingest:madrid`; expect a 5–10× increase in candidates.
4. **M6e — Open-now evaluator**. New file `apps/api/src/openNow.ts` with:
   - `isOpenNow(opening_hours_osm, now): { open, closesAt }`
   - `isAlcoholTakeawayProhibited(now): boolean` (22:00 → 09:00)
   - `canSellBeerNow(place, now): { ok, reason }`
   Pure functions, Europe/Madrid timezone, fully Vitest-covered.
5. **M6f — `/stores/nearby` v2**. Add `place_type`, `intent`, `open_now`,
   `at_time`, `min_confidence`, `hide_chains` params. Response includes
   `now`, `ordinance`, and per-result `open_now` block (see doc 05).
6. **M6g — OSM enrichment worker**. New CLI `ingest:osm`. Overpass query
   for Madrid bbox, spatial+name match to `stores`, upsert into
   `store_osm_enrichment`, materialise `opening_hours_osm` onto `stores`.
7. **M6h — Web UI v2**. Time chip, "Para tomar / Para llevar" filters,
   open-now marker colours, new place card copy (see doc 08).

## Architecture boundaries

```
apps/api          Fastify + Zod + openNow evaluator
apps/web          Vite + React + MapLibre
apps/worker       ingest:sample, ingest:madrid, diagnose:madrid, ingest:osm
packages/db       node-pg-migrate + postgres-js
packages/shared   Zod schemas, types (Store, PlaceType, OpenNow, etc.)
```

## Definition of done for v1

- Madrid-wide map of beer sources.
- At 13:00: shops and bars interleaved, mostly green.
- At 23:30: bars green; shops shown amber with "ordenanza municipal"
  reason on the card.
- Top-3 nearby results for any Madrid address are real, walkable, and
  correctly classified by `place_type` and intent.
- A user can submit a "wrong_hours" correction in under 15 seconds.
- Docker Compose runs the whole stack locally.

## What success on this brief looks like

The agent ships M6 incrementally — small, reviewable steps with the same
discipline used in M5 (Read before Write, ask before destructive moves,
narrate decisions, write tests for the scorer and the open-now evaluator,
keep CLAUDE.md principles intact).
