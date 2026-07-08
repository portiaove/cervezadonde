# 10 — Delivery Plan

## Phase 0 — Technical spike (done)

Repo scaffolding, PostGIS up, fixture ingest, /stores/nearby, map UI.
First milestone of pre-pivot work — kept intact, sample fixture lives under
`source_name='madrid_sample_fixture'`.

## Phase 1 — Beer-MVP foundation (current)

Goal: ship the beer-now product, end-to-end, against real Madrid data + OSM.

Deliverables:

- **M6a — Domain pivot** (this batch of doc rewrites + ADRs 004/005).
- **M6b — Schema migration #5**: add `place_type`, `sells_takeaway_beer`,
  `sells_onsite_beer`, `opening_hours_osm`, `last_seen_osm_at`, plus
  `store_osm_enrichment` table.
- **M6c — Scorer v2-beer**: `apps/worker/src/scoring/v2.ts` per doc 07.
  Re-score existing Madrid Censo rows in place.
- **M6d — Broaden Censo target epigraphs**: include 561xxx (bars) and the
  expanded list in doc 02. Re-ingest.
- **M6e — Open-now evaluator**: `apps/api/src/openNow.ts` consuming
  `opening_hours_osm` + Europe/Madrid time + ADR-004 ordinance window.
- **M6f — /stores/nearby v2**: new query params (`place_type`, `intent`,
  `open_now`, `at_time`), response shape with `open_now` block.
- **M6g — OSM enrichment worker**: Overpass fetch, spatial+name match,
  upsert into `store_osm_enrichment` + materialise `opening_hours_osm`
  onto `stores`.
- **M6h — Web UI v2**: time chip, "Para tomar / Para llevar" filters,
  open-now marker colours, new place card copy.
- **Vitest** coverage for `openNow` (ordinance window, opening_hours
  parsing) and `scoring/v2`.

Exit criteria:

- At 13:00 the map shows bars + shops, all green for the open ones.
- At 23:30 shops are amber ("no puede vender ahora"); bars stay green.
- Top-3 nearby results for Sol are real, walkable, accurate by intent.

## Phase 2 — Product quality

- Filter UX polish.
- Store detail page.
- User feedback endpoint live + moderation queue.
- Admin token endpoints.
- Better scoring explanations in the place card.
- Anti-spam for anonymous feedback.

Exit: a user can correct an opening hour and see it accepted within a
moderation cycle.

## Phase 3 — Launch readiness

- Public-name decision.
- Production deployment (managed Postgres + container + tile provider).
- Scheduled cron for both ingestion pipelines.
- Error logging and import-run monitoring.
- Attribution / about page (Madrid + OSM + ordinance + responsible drinking).
- Privacy-light feedback handling reviewed.

Exit: the app can be shared publicly. Failed import does not break the app.

## Phase 4 — After MVP

- Sunday / holiday calendar awareness for shops.
- Gas station coverage (`amenity=fuel` + shop sub-tag).
- Beer-temperature signal (community-only).
- Madrid neighbourhood landing pages (SEO).
- Sister cities (Barcelona, Valencia) — would force a Spain-wide variation
  of the ordinance lookup.
