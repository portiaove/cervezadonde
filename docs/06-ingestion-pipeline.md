# 06 — Ingestion Pipeline

Two independent pipelines: **Madrid Censo** (daily) and **OSM enrichment**
(weekly). Each writes to its own tables and only the Censo pipeline drives
the canonical `stores` row.

## A. Madrid Censo pipeline

### Schedule

Daily at 04:00 Europe/Madrid.

Why daily: official source isn't user-specific, changes are infrequent
relative to the product, batch is simpler than request-time fetching.

### Pipeline stages

1. **Start import_run**. Status='running'.
2. **Download source file**. Cache by SHA-256; skip if hash matches a
   previous run.
3. **TRUNCATE staging_madrid_actividades**.
4. **COPY FROM STDIN** into staging (UTF-8, `;` delimiter, `"` quote,
   HEADER true). 225k rows in ~10 seconds.
5. **Validate**: column count, encoding sanity, non-zero row count.
6. **Aggregate candidates** per `id_local`:
   - `id_tipo_acceso_local = '1'` (Puerta Calle)
   - `id_situacion_local = '1'` (Abierto)
   - Coordinates inside Madrid UTM bbox
   - At least one epigraph in the target set (doc 02)
7. **Transform coords** EPSG:25830 → 4326 in Postgres (`ST_Transform`).
8. **Score** via `scoring/v2.ts`. Computes `place_type`,
   `sells_takeaway_beer`, `sells_onsite_beer`, `confidence_*`, `badges`.
9. **Upsert** into `stores` under `source_name='censo_madrid'`. Conflict
   on `(source_name, source_local_id)`. Refresh `store_activities`.
10. **Soft-deactivate**: rows with `source_name='censo_madrid'` and a
    `last_import_run_id` other than the current one get
    `confidence_level='excluded'` + `'posible_cerrado'` badge.
    Score and place_type preserved for traceability.
11. **Finalise import_run**: status='succeeded', counts.

### Failure strategy

Failed run keeps the previous canonical data intact. `import_runs.status =
'failed'` with `error_message`. If the latest successful run is >7 days
old, surface an admin warning.

## B. OSM enrichment pipeline

### Schedule

Weekly. Cheap enough to also run manually after schema or query changes.

### Pipeline stages

1. **Overpass query** for Madrid bbox with the tag filters from doc 02
   (`shop=convenience|alcohol|...`, `amenity=bar|pub|...`).
2. **Cache JSON response** to `data/raw/osm-madrid-{date}.json`.
3. **Parse + validate**: ensure each element has `id`, `type`, and either
   `center` (way) or `lat/lon` (node). Drop the rest.
4. **Match to stores** per element:
   - Find `stores` rows within 25 m.
   - Score name similarity (normalised Levenshtein or token-set ratio).
   - Best match wins; record `matched_by` and `match_distance_m`.
   - Unmatched OSM elements are kept in `store_osm_enrichment` with
     `store_id IS NULL` for v1.1 review.
5. **Upsert** into `store_osm_enrichment`. One row per `(osm_id, osm_type)`.
6. **Materialise** `opening_hours_osm`, `last_seen_osm_at` and a couple of
   small flags onto `stores` for query speed. Original OSM row stays in
   the enrichment table.
7. **Soft-deactivate** OSM enrichment rows not seen this run by setting
   `last_seen_osm_at` stale — never deleted.

## Source URLs and configuration

URLs and cache locations live in `.env`. See `.env.example`.

- `MADRID_CENSO_ACTIVIDADES_URL`
- `MADRID_CENSO_LOCALES_URL`
- `MADRID_CACHE_DIR`
- `OSM_OVERPASS_URL` (Phase 1)
- `OSM_BBOX` (Phase 1)

## Staleness warnings

- Censo: warn admin if latest succeeded run is >7 days old.
- OSM: warn admin if latest succeeded run is >30 days old.
- Public copy: degrade to "horario no confirmado" for affected rows;
  never raise hard errors at the user.
