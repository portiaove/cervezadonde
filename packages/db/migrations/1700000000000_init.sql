-- Up Migration

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE confidence_level AS ENUM ('high', 'medium', 'low', 'excluded');

CREATE TABLE import_runs (
  id              BIGSERIAL PRIMARY KEY,
  source_name     TEXT        NOT NULL,
  source_url      TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'succeeded', 'failed')),
  file_hash       TEXT,
  row_count       INTEGER,
  inserted_count  INTEGER,
  updated_count   INTEGER,
  deactivated_count INTEGER,
  error_message   TEXT
);

CREATE TABLE stores (
  id                              BIGSERIAL PRIMARY KEY,
  source_local_id                 TEXT        NOT NULL,
  source_name                     TEXT        NOT NULL DEFAULT 'madrid_censo',
  name                            TEXT        NOT NULL,
  normalized_name                 TEXT        NOT NULL,
  address                         TEXT,
  postal_code                     TEXT,
  district                        TEXT,
  neighbourhood                   TEXT,
  geom                            geometry(Point, 4326) NOT NULL,
  primary_category                TEXT,
  badges                          TEXT[]      NOT NULL DEFAULT '{}',
  confidence_score                SMALLINT    NOT NULL DEFAULT 0
                                  CHECK (confidence_score BETWEEN 0 AND 100),
  confidence_level                confidence_level NOT NULL DEFAULT 'low',
  scoring_version                 TEXT        NOT NULL DEFAULT 'v0-fixture',
  is_chain                        BOOLEAN     NOT NULL DEFAULT FALSE,
  official_status                 TEXT,
  last_seen_in_official_source_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_import_run_id              BIGINT      REFERENCES import_runs(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_name, source_local_id)
);

CREATE INDEX stores_geom_gix ON stores USING GIST (geom);
CREATE INDEX stores_confidence_level_idx ON stores (confidence_level);
CREATE INDEX stores_is_chain_idx ON stores (is_chain);

CREATE TABLE store_activities (
  id                    BIGSERIAL PRIMARY KEY,
  store_id              BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  source_activity_id    TEXT,
  epigraph_code         TEXT        NOT NULL,
  epigraph_description  TEXT,
  is_target_epigraph    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_activities_store_idx ON store_activities (store_id);
CREATE INDEX store_activities_epigraph_idx ON store_activities (epigraph_code);

-- Down Migration

DROP TABLE IF EXISTS store_activities;
DROP INDEX IF EXISTS stores_is_chain_idx;
DROP INDEX IF EXISTS stores_confidence_level_idx;
DROP INDEX IF EXISTS stores_geom_gix;
DROP TABLE IF EXISTS stores;
DROP TABLE IF EXISTS import_runs;
DROP TYPE IF EXISTS confidence_level;
