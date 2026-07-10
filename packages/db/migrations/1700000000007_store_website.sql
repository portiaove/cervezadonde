-- Up Migration

-- The business's own website, from OSM's website/contact:website tags.
-- Feeds the schema.org opening-hours crawler (roadmap §5 / docs/12): premises
-- with a website but no hours are the crawler's work queue.

ALTER TABLE stores ADD COLUMN website TEXT;

COMMENT ON COLUMN stores.website IS
  'Business website (normalised URL). Source: OSM website/contact:website tags.';

-- Down Migration

ALTER TABLE stores DROP COLUMN IF EXISTS website;
