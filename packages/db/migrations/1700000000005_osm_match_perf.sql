-- Up Migration

-- Functional GIST index on the geography cast of stores.geom.
-- The OSM match step and the API's /nearby + /map queries all filter with
-- ST_DWithin(geom::geography, ...) / order by geom::geography <-> ...; without
-- this index those casts force a sequential scan over every store. Indexing the
-- exact cast expression lets PostGIS use it directly.

CREATE INDEX IF NOT EXISTS stores_geog_gix
  ON stores USING GIST ((geom::geography));

-- Down Migration

DROP INDEX IF EXISTS stores_geog_gix;
