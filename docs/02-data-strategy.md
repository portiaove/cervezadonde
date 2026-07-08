# 02 — Data Strategy

## Data philosophy

Two complementary baselines: Madrid Censo for **what exists where**, OSM for
**when it's open**. Community feedback is the long-term quality layer.
No Google Maps scraping (ADR-003).

## Primary source: Madrid open data

Same dataset as before — `Censo de locales, sus actividades y terrazas de
hostelería y restauración` — but with a broader, beer-oriented target set
now that bars are first-class.

### Target epigraphs

**Takeaway candidates (shops):**

- `471101`, `471103`, `471104` — alimentación / conveniencia
- `472911` — variety food retail
- `472501` — leche, dairy, non-alcoholic drinks (often sells beer too)
- `472502` — bebidas alcohólicas sin consumo (bodegas)
- `472907`, `472908`, `472909` — snacks (often co-located with beer)

**On-site candidates (bars / cafeterías):**

- `561001` Bares
- `561002` Cafés
- `561004` Bares especiales / nocturnos
- `561005` Cafeterías

A local is a candidate if at least one of its epigraphs is in any group
above.

## Secondary source: OpenStreetMap

Promoted from "Phase 4 enrichment" to a **first-class source** for v1.
This is where `opening_hours` lives for most bars and many shops.

### OSM tags we ingest

- `shop=convenience|alcohol|supermarket|general|kiosk`
- `amenity=bar|pub|restaurant|cafe|fast_food` (filtered by likely beer service)
- `opening_hours` (parsed per OSM spec)
- `name` (fallback when Censo rotulo is missing)
- `addr:*` (fallback address)

### How we use OSM

- Pulled periodically via Overpass for the Madrid bbox.
- Matched to Madrid Censo entries by spatial proximity (`ST_DWithin <= 25 m`)
  plus name similarity.
- OSM-only places (no Censo match) are kept as community-only entries with
  lower confidence.
- OSM-derived fields live in a separate `store_osm_enrichment` table so
  ODbL obligations stay manageable. We never overwrite Censo columns with
  OSM data.

### ODbL note

Public-facing display credits "© OpenStreetMap contributors" wherever an
OSM-derived field is shown. The separation between `stores` (Censo +
inferred) and `store_osm_enrichment` (OSM) lets us reason about share-alike
obligations cleanly. See ADR-005.

## Tertiary source: community feedback

Anonymous user reports. Real-time write, batched moderation. Never
overwrites canonical data; influences confidence and adds badges after
threshold or admin acceptance.

## Explicitly avoided: Google Maps

Same as before. No scraping, no bulk extraction. (ADR-003.)

## Data freshness model

| Source | Strategy |
|---|---|
| Madrid Censo | Daily batch at 04:00 Europe/Madrid (Phase 3 cron). |
| OpenStreetMap | Weekly Overpass query for Madrid bbox (Phase 1). |
| Community feedback | Real-time write; moderation queued. |

The app does not fetch external data on user request. Reads go to PostGIS.

## Data quality vocabulary

Public-facing copy uses:

- "Horario oficial" — from OSM with high confidence.
- "Horario no confirmado" — we have a category but no hours.
- "Verificado por usuarios" — community-confirmed.
- "Puede estar cerrado" — last seen status not recent.
- "No puede vender ahora" — Madrid ordinance applies (ADR-004).

## Source layers

1. `official_madrid`
2. `osm`
3. `inferred` (scoring + derived flags)
4. `community`
5. `manual_admin`

All five are kept separable. The display row is **computed** from the
layers, never stored as flat truth.

## Data ingestion shape (unchanged)

Per import run, we record:

- `source_name`, `source_url`, `downloaded_at`, `file_hash`,
  `row_count`, `status`, `error_message`.

Staging tables are disposable. Canonical tables are stable.
