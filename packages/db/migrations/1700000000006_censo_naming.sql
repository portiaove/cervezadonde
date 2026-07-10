-- Up Migration

-- ADR-007 follow-up: official municipal censos are named censo_<city> so the
-- enrichment step can match ANY of them (source_name LIKE 'censo_%') instead
-- of hardcoding Madrid. Rename the existing Madrid rows to the new scheme.

UPDATE stores
SET source_name = 'censo_madrid'
WHERE source_name = 'madrid_censo';

-- The init-era default ('madrid_censo') is a stale foot-gun: every ingest path
-- sets source_name explicitly, so an INSERT relying on the default would be a
-- bug worth surfacing rather than silently mislabelling the row.

ALTER TABLE stores ALTER COLUMN source_name DROP DEFAULT;

-- Down Migration

ALTER TABLE stores ALTER COLUMN source_name SET DEFAULT 'madrid_censo';

UPDATE stores
SET source_name = 'madrid_censo'
WHERE source_name = 'censo_madrid';
