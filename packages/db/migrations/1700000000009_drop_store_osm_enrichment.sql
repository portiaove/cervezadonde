-- Up Migration

-- store_osm_enrichment + the legacy `ingest:osm` (Overpass hours-only) worker
-- are obsolete: since ADR-007 the canonical pbf ingest (persistOsmCanonical)
-- writes opening_hours_osm straight onto `stores`, so this table was never
-- populated any more. Drop it and correct the now-stale column comment.

DROP TABLE IF EXISTS store_osm_enrichment;

COMMENT ON COLUMN stores.opening_hours_osm IS
  'OSM opening_hours string, written directly by the canonical OSM ingest (ADR-007).';

-- Down Migration

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
