# ADR-007 — OSM as the canonical national source; Censo becomes enrichment

## Status

Accepted — 2026-07-09.

## Context

The product covers Madrid city today, built on the Ayuntamiento de Madrid
Censo de Locales. The goal is **Spain-wide**. There is **no unified national
registry of premises**: each of Spain's ~8,131 municipalities publishes its own
censo (or, usually, none), in incompatible formats (confirmed via datos.gob.es).
Federating thousands of municipal datasets does not scale.

OpenStreetMap is the only source that covers all of Spain with **one uniform
schema**, for free (ODbL), and it already carries both *what places exist*
(`amenity=bar|pub|cafe|restaurant|fast_food`, `shop=convenience|supermarket|
alcohol|…`) **and** `opening_hours`.

## Decision

**OSM becomes the canonical source of stores nationwide.** The Madrid Censo is
demoted from canonical to a **Madrid-only enrichment** layer.

- OSM POIs are ingested into `stores` under `source_name='osm'`, classified by
  tags into `place_type` + intent (`sells_onsite_beer` / `sells_takeaway_beer`)
  and carrying `opening_hours_osm`.
- Where a Madrid Censo record matches an OSM store (spatial + name), the OSM
  store is flagged **`oficial`** (Censo confirms it) and the Censo row is
  excluded from display — no double-listing. Censo records with no OSM match
  stay active (Censo still contributes places OSM lacks in Madrid).
- Barcelona / Valencia / other good municipal censos can be added later the
  same way — as optional enrichment, never a per-province requirement.

### Tooling

- **Prototype (a region):** reuse the existing Overpass pipeline with a region
  bbox (Comunidad de Madrid). Fast, no new tooling.
- **Full Spain (later):** download the Geofabrik `spain-latest.osm.pbf`
  (~1.4 GB, monthly) and filter POIs locally with **osmium `tags-filter`**
  (run in Docker) — the right tool at national scale, and it fits the
  "pipeline on the maintainer's PC" model (ADR-006). Overpass is not for
  repeatedly scraping the whole country.

## Consequences

- The canonical `stores` table becomes overwhelmingly **OSM-derived**, so ODbL
  attribution ("© OpenStreetMap contributors") is front-and-centre (already
  present). Provenance stays layered: `osm` (canonical) → `official_madrid`
  (enrichment) → `community` (later).
- Scale jumps from ~16k (Madrid city) to ~300k–600k (Spain). PostGIS handles
  it; the `pg_dump` serving-table push to the VPS grows to tens of MB — still
  the same `push-data` flow.
- The Censo ingest and scorer v2 are **kept** (Madrid enrichment + a reference
  classifier), not deleted.
- New worker: OSM→`stores` canonical ingest + a Censo-match enrichment step.
- The `otro`/low-confidence handling matters more: OSM has messy tags; keep the
  classifier conservative and lean on `confidence_level`.

## Alternatives considered

- **Federate municipal open data:** rejected — thousands of heterogeneous
  datasets, most municipalities publish nothing. A prior third-party attempt
  ("Comercios Locales de España") is inherently partial for this reason.
- **Overture / Foursquare-OS as the base:** open and nationwide, but **no
  opening hours** (ADR-005 / docs/12); useful later only to widen coverage
  (websites, extra POIs), not as the hours-bearing backbone.
- **Geographic partition (Censo in Madrid, OSM elsewhere):** two code paths and
  a seam at the city border; rejected in favour of one uniform OSM-canonical
  model with Censo as enrichment.
