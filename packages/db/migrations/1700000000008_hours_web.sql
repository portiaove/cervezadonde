-- Up Migration

-- Opening hours crawled from the business's own website (schema.org
-- OpeningHoursSpecification / openingHours in JSON-LD), converted to OSM
-- opening_hours syntax and validated with the same parser the API uses.
-- Kept separate from opening_hours_osm: the OSM ingest overwrites its own
-- column weekly, crawled hours must survive that.

ALTER TABLE stores ADD COLUMN opening_hours_web TEXT;
ALTER TABLE stores ADD COLUMN hours_web_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN stores.opening_hours_web IS
  'Hours from the business website (schema.org via crawl:hours), OSM syntax, parser-validated.';
COMMENT ON COLUMN stores.hours_web_checked_at IS
  'When crawl:hours last checked the website — set on success AND on failure/no-hours, so the crawl is incremental.';

-- Down Migration

ALTER TABLE stores DROP COLUMN IF EXISTS opening_hours_web;
ALTER TABLE stores DROP COLUMN IF EXISTS hours_web_checked_at;
