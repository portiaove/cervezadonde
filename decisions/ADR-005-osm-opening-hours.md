# ADR-005 — OpenStreetMap as the primary source of opening hours

## Status

Accepted — 2026-06-02.

## Context

The product needs opening-hours data to deliver its core promise ("open
right now"). The Madrid Censo de Locales does not include opening hours.
The options were:

1. **OSM Overpass weekly pull** — community-curated `opening_hours` tags
   on bars, shops and amenities, in a well-defined parseable syntax.
2. **Google Places API** — comprehensive but rejected on principle (ADR-003)
   and on cost / TOS friction.
3. **Build our own from scratch via user feedback** — too slow; the map
   would be unusable at launch.
4. **Wait for a city-provided dataset** — none exists in usable form.

## Decision

OpenStreetMap is the primary source of opening hours, ingested weekly via
Overpass for the Madrid bounding box. OSM moves from "Phase 4
enrichment" (original plan) to a **Phase 1 first-class source**.

### Storage

OSM-derived data lives in **two places**:

- `store_osm_enrichment` — full provenance: `osm_id`, `osm_type`,
  `opening_hours_raw`, `name_osm`, `address_osm`, `matched_by`,
  `match_distance_m`, `last_fetched_at`. One row per OSM element.
- `stores.opening_hours_osm` — denormalised cache for query speed.
  Materialised from the enrichment row whenever it changes.

The two locations let us:

- Query nearby + open-now efficiently (no join in the hot path).
- Trace every shown hour back to its OSM element id for ODbL compliance.

### Matching

OSM element → `stores` row by:

1. Spatial proximity: `ST_DWithin <= 25 m`.
2. Name similarity: normalised token-set ratio above 0.6.
3. Best joint score wins.
4. Unmatched OSM elements stay in `store_osm_enrichment` with
   `store_id = NULL` for v1.1 review.

### Refresh cadence

Weekly. Madrid Censo runs daily. Their schedules are independent.

## Rationale

- **OSM is the only honest answer for hours.** Censo doesn't have them,
  Google is out, community-only would mean an empty product at launch.
- **Separable storage preserves ODbL clarity.** Even if a courtroom asked
  "which fields came from OSM?" the answer is one SQL query against
  `store_osm_enrichment`.
- **Denormalising onto `stores` is acceptable.** OSM gives us a permissive
  licence for derivative display so long as attribution is in place; the
  cache is a derivative form. The provenance row stays canonical.
- **Weekly is enough.** Opening hours don't change that often. Saving the
  Overpass servers a daily hit is good citizenship.

## Consequences

- New worker: `apps/worker/src/ingest-osm.ts`. New migration: add
  `store_osm_enrichment` table + `opening_hours_osm` column on `stores`.
- New env vars: `OSM_OVERPASS_URL`, `OSM_BBOX`, optional
  `OSM_OVERPASS_TIMEOUT`.
- New attribution requirement: "© OpenStreetMap contributors" everywhere
  an OSM-derived field is shown (already needed for tiles, now extended to
  hours and OSM-source names/addresses).
- `confidence_level=high` now requires hours to be present. Rows without
  hours top out at `medium` even if everything else is perfect.

## Open questions deferred

- Should we also ingest non-Madrid OSM data for users near the boundary
  (Pozuelo, Alcorcón)? No for v1.
- Should we contribute back corrected hours to OSM when users submit
  feedback? Not in v1; revisit in Phase 2 if feedback volume justifies it.
- Should we parse the `opening_hours` syntax client-side too? No — keep
  the evaluator server-side as the single source of truth.
