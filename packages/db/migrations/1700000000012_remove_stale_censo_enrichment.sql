-- Up Migration

-- The legacy proximity merge copied censo fields onto canonical OSM rows.
-- Once the relation was rebuilt, those values could survive even when the
-- match was rejected. They have no field-level provenance and therefore must
-- not be served as if they came from OSM. A subsequent OSM ingest restores
-- canonical OSM addresses; the censo layer keeps its own complete fields.
--
-- The original schema also defaulted the official-source timestamp on every
-- row, including OSM. Make it genuinely source-specific before clearing it.
ALTER TABLE stores
  ALTER COLUMN last_seen_in_official_source_at DROP NOT NULL,
  ALTER COLUMN last_seen_in_official_source_at DROP DEFAULT;

UPDATE stores
SET
  -- Address was also conditionally copied by the legacy merge. Without a
  -- persisted source marker it cannot be separated safely from an OSM
  -- address, so prefer temporary absence until the next OSM re-ingest.
  address = NULL,
  district = NULL,
  neighbourhood = NULL,
  official_status = NULL,
  last_seen_in_official_source_at = NULL,
  updated_at = now()
WHERE source_name = 'osm';

-- Down Migration

-- Field values are intentionally not reconstructed: their provenance was not
-- persisted. Restoring the old timestamp constraint is necessarily lossy.
UPDATE stores
SET last_seen_in_official_source_at = now()
WHERE last_seen_in_official_source_at IS NULL;

ALTER TABLE stores
  ALTER COLUMN last_seen_in_official_source_at SET DEFAULT now(),
  ALTER COLUMN last_seen_in_official_source_at SET NOT NULL;
