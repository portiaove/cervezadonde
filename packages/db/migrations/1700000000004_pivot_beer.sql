-- Up Migration

-- Pivot to the beer-now product (see docs/01-product.md + ADR-004/005).
-- Adds place_type taxonomy, sells_*_beer booleans, OSM hours fields,
-- and the store_osm_enrichment table that keeps OSM-derived data
-- separable for ODbL compliance.

CREATE TYPE place_type AS ENUM (
  'bar',
  'supermercado',
  'alimentacion',
  'bodega',
  'tienda_24h',
  'otro'
);

ALTER TABLE stores
  ADD COLUMN place_type           place_type,
  ADD COLUMN sells_takeaway_beer  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN sells_onsite_beer    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN opening_hours_osm    TEXT,
  ADD COLUMN last_seen_osm_at     TIMESTAMPTZ;

CREATE INDEX stores_place_type_idx       ON stores (place_type);
CREATE INDEX stores_takeaway_beer_idx    ON stores (sells_takeaway_beer) WHERE sells_takeaway_beer = TRUE;
CREATE INDEX stores_onsite_beer_idx      ON stores (sells_onsite_beer)   WHERE sells_onsite_beer   = TRUE;

-- Backfill place_type and the sells_*_beer booleans from the existing
-- primary_category. Conservative mapping: chains become 'supermercado',
-- conveniencia → tienda_24h (most are 24h-leaning in current data),
-- the rest follow the obvious correspondence.

UPDATE stores
SET
  place_type = CASE
    WHEN is_chain = TRUE                          THEN 'supermercado'::place_type
    WHEN primary_category = 'conveniencia'        THEN 'tienda_24h'::place_type
    WHEN primary_category = 'alimentacion'        THEN 'alimentacion'::place_type
    WHEN primary_category = 'ultramarinos'        THEN 'alimentacion'::place_type
    WHEN primary_category = 'bodega'              THEN 'bodega'::place_type
    WHEN primary_category = 'snacks'              THEN 'otro'::place_type
    ELSE                                               'otro'::place_type
  END,
  sells_takeaway_beer = CASE
    WHEN is_chain = TRUE                                                                THEN TRUE
    WHEN primary_category IN ('conveniencia','alimentacion','ultramarinos','bodega')    THEN TRUE
    ELSE FALSE
  END,
  sells_onsite_beer = FALSE
WHERE source_name IN ('madrid_censo', 'madrid_sample_fixture')
  AND place_type IS NULL;

-- OSM enrichment table (ADR-005).
-- One row per (osm_id, osm_type). store_id may be NULL when no Censo match
-- is found — those rows are review candidates for v1.1.

CREATE TABLE store_osm_enrichment (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT REFERENCES stores(id) ON DELETE SET NULL,
  osm_id              BIGINT NOT NULL,
  osm_type            TEXT   NOT NULL CHECK (osm_type IN ('node','way','relation')),
  geom                geometry(Point, 4326),
  name_osm            TEXT,
  address_osm         TEXT,
  opening_hours_raw   TEXT,
  shop_tag            TEXT,
  amenity_tag         TEXT,
  tags                JSONB,
  matched_by          TEXT CHECK (matched_by IN ('name','spatial','both')),
  match_distance_m    DOUBLE PRECISION,
  match_score         REAL,
  last_fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (osm_id, osm_type)
);

CREATE INDEX store_osm_enrichment_store_idx  ON store_osm_enrichment (store_id);
CREATE INDEX store_osm_enrichment_geom_gix   ON store_osm_enrichment USING GIST (geom);
CREATE INDEX store_osm_enrichment_hours_idx
  ON store_osm_enrichment (store_id)
  WHERE opening_hours_raw IS NOT NULL;

COMMENT ON TABLE store_osm_enrichment IS
  'OSM-derived enrichment kept separable for ODbL compliance. See ADR-005.';
COMMENT ON COLUMN stores.opening_hours_osm IS
  'Materialised cache of the OSM opening_hours string. Canonical row lives in store_osm_enrichment.';
COMMENT ON COLUMN stores.place_type IS
  'Functional category derived by the scorer. See docs/04-domain-model.md.';

-- Down Migration

DROP TABLE IF EXISTS store_osm_enrichment;
DROP INDEX IF EXISTS stores_onsite_beer_idx;
DROP INDEX IF EXISTS stores_takeaway_beer_idx;
DROP INDEX IF EXISTS stores_place_type_idx;
ALTER TABLE stores
  DROP COLUMN IF EXISTS last_seen_osm_at,
  DROP COLUMN IF EXISTS opening_hours_osm,
  DROP COLUMN IF EXISTS sells_onsite_beer,
  DROP COLUMN IF EXISTS sells_takeaway_beer,
  DROP COLUMN IF EXISTS place_type;
DROP TYPE IF EXISTS place_type;
