-- Up Migration

-- Gas stations with a shop (or staffed opening_hours as a proxy) become their
-- own place_type: reliable takeaway / often-24h beer sources. Ingested from OSM
-- amenity=fuel (see apps/worker/src/sources/osm.ts + ingest-osm-pbf.ts).
-- PostgreSQL 12+ allows ADD VALUE inside a transaction as long as the new value
-- isn't used in the same one (it isn't here).

ALTER TYPE place_type ADD VALUE IF NOT EXISTS 'gasolinera';

-- Down Migration

-- PostgreSQL cannot drop a value from an enum type; reverting would require
-- recreating the type and rewriting the column. Intentional no-op.
