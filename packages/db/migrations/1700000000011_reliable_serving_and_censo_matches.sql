-- Up Migration

-- Classification confidence is not a publication decision. Keep unreliable
-- rows for audit/reprocessing while controlling whether the API may serve them
-- with an explicit, reversible flag.
ALTER TABLE stores
  ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN publication_reason TEXT DEFAULT 'censo_only_unconfirmed';

-- Persist the accepted censo evidence on the canonical OSM row. The matching
-- algorithm is deliberately one-to-one; the partial unique index enforces that
-- one censo record cannot corroborate several OSM businesses.
ALTER TABLE stores
  ADD COLUMN matched_censo_source TEXT,
  ADD COLUMN matched_censo_local_id TEXT,
  ADD COLUMN censo_match_version TEXT,
  ADD COLUMN censo_match_method TEXT,
  ADD COLUMN censo_match_distance_m REAL,
  ADD COLUMN censo_match_name_similarity REAL,
  ADD CONSTRAINT stores_censo_match_fields_check CHECK (
    (
      matched_censo_source IS NULL
      AND matched_censo_local_id IS NULL
      AND censo_match_version IS NULL
      AND censo_match_method IS NULL
      AND censo_match_distance_m IS NULL
      AND censo_match_name_similarity IS NULL
    )
    OR
    (
      source_name = 'osm'
      AND matched_censo_source LIKE 'censo_%'
      AND matched_censo_local_id IS NOT NULL
      AND censo_match_version IS NOT NULL
      AND censo_match_method IN (
        'exact_name',
        'strong_name',
        'name_and_type'
      )
      AND censo_match_distance_m BETWEEN 0 AND 30
      AND censo_match_name_similarity BETWEEN 0 AND 1
    )
  );

CREATE UNIQUE INDEX stores_one_osm_per_censo_match_idx
  ON stores (matched_censo_source, matched_censo_local_id)
  WHERE matched_censo_source IS NOT NULL;

CREATE INDEX stores_published_geom_gix
  ON stores USING GIST (geom)
  WHERE is_published AND confidence_level <> 'excluded';

COMMENT ON COLUMN stores.is_published IS
  'Explicit serving decision, separate from classification confidence. Only published rows may reach public API results.';
COMMENT ON COLUMN stores.publication_reason IS
  'Why a row is published/hidden (censo_only_unconfirmed, matched_to_osm, development_fixture, osm_missing_latest_extract).';
COMMENT ON COLUMN stores.matched_censo_source IS
  'Official censo source accepted as high-precision identity evidence for this canonical OSM row.';
COMMENT ON COLUMN stores.censo_match_version IS
  'Versioned OSM↔censo identity policy that accepted the persisted match.';

-- Precision-first baseline: active OSM rows remain public. Censo-only rows and
-- the development fixture remain physically present but are not served.
UPDATE stores
SET
  is_published = TRUE,
  publication_reason = NULL
WHERE source_name = 'osm' AND confidence_level <> 'excluded';

UPDATE stores
SET publication_reason = 'osm_missing_latest_extract'
WHERE source_name = 'osm' AND confidence_level = 'excluded';

UPDATE stores
SET publication_reason = CASE
  WHEN 'posible_cerrado' = ANY(badges)
    OR lower(COALESCE(official_status, '')) IN ('cerrado', 'baja', 'baja r')
    THEN 'censo_source_closed'
  ELSE 'censo_only_unconfirmed'
END
WHERE source_name LIKE 'censo_%';

UPDATE stores
SET publication_reason = 'development_fixture'
WHERE source_name = 'madrid_sample_fixture';

-- Existing `oficial` badges came from proximity-only matching. Remove that
-- claim; refine:censo-matches will rebuild only evidence-backed matches.
UPDATE stores
SET badges = array_remove(badges, 'oficial')
WHERE source_name = 'osm' AND 'oficial' = ANY(badges);

-- Down Migration

DROP INDEX IF EXISTS stores_published_geom_gix;
DROP INDEX IF EXISTS stores_one_osm_per_censo_match_idx;

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_censo_match_fields_check,
  DROP COLUMN IF EXISTS censo_match_name_similarity,
  DROP COLUMN IF EXISTS censo_match_distance_m,
  DROP COLUMN IF EXISTS censo_match_method,
  DROP COLUMN IF EXISTS censo_match_version,
  DROP COLUMN IF EXISTS matched_censo_local_id,
  DROP COLUMN IF EXISTS matched_censo_source,
  DROP COLUMN IF EXISTS publication_reason,
  DROP COLUMN IF EXISTS is_published;
