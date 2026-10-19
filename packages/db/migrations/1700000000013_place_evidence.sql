-- Up Migration

ALTER TABLE stores
  ADD COLUMN osm_tags jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN osm_element_updated_at timestamptz,
  ADD COLUMN beer_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN beer_evidence text NOT NULL DEFAULT 'likely'
    CHECK (beer_evidence IN ('likely','documented','unknown','no')),
  ADD COLUMN beer_evidence_reason text NOT NULL DEFAULT 'category_inference',
  ADD COLUMN hours_web_observed_at timestamptz;

-- Legacy fuel hours describe the pumps, not a shop or its beer stock.
UPDATE stores SET beer_eligible=false, beer_evidence='unknown',
  beer_evidence_reason='fuel_without_retail_evidence'
WHERE place_type::text='gasolinera';

-- Production-owned evidence MUST NOT reference the replaceable stores PK.
-- Snapshot publication replaces stores/import_runs; these tables survive it.
CREATE TABLE place_reports (
  id bigserial PRIMARY KEY,
  source_name text NOT NULL,
  source_local_id text NOT NULL,
  normalized_name text NOT NULL,
  place_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('closed_now','closed_permanently','no_beer','wrong_hours')),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  reviewed_at timestamptz,
  reviewer text,
  review_note text
);
CREATE UNIQUE INDEX place_reports_one_pending ON place_reports
  (source_name,source_local_id,normalized_name,kind) WHERE status='pending';
CREATE INDEX place_reports_queue ON place_reports(created_at) WHERE status='pending';

CREATE TABLE place_corrections (
  id bigserial PRIMARY KEY,
  source_name text NOT NULL,
  source_local_id text NOT NULL,
  normalized_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('closed_now','closed_permanently','no_beer','wrong_hours','hours')),
  hours text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  reviewer text NOT NULL,
  note text NOT NULL,
  report_id bigint REFERENCES place_reports(id),
  CHECK ((kind='hours') = (hours IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_until>observed_at),
  CHECK (kind<>'closed_now' OR (valid_until IS NOT NULL AND valid_until<=observed_at+interval '6 hours')),
  CHECK (kind<>'hours' OR (valid_until IS NOT NULL AND valid_until<=observed_at+interval '180 days'))
);
CREATE INDEX place_corrections_lookup ON place_corrections
  (source_name,source_local_id,normalized_name) WHERE revoked_at IS NULL;

-- One serving boundary shared by points, nearest, clusters and metadata.
-- A renamed/replaced business does not inherit the old business's correction.
CREATE VIEW serving_stores AS
SELECT s.*,
  EXISTS (SELECT 1 FROM place_corrections c
    WHERE c.source_name=s.source_name AND c.source_local_id=s.source_local_id
      AND c.normalized_name=s.normalized_name AND c.revoked_at IS NULL
      AND (c.valid_until IS NULL OR c.valid_until>now()) AND c.kind='wrong_hours') AS hours_disputed,
  (SELECT c.hours FROM place_corrections c
    WHERE c.source_name=s.source_name AND c.source_local_id=s.source_local_id
      AND c.normalized_name=s.normalized_name AND c.revoked_at IS NULL
      AND c.valid_until>now() AND c.kind='hours'
    ORDER BY c.observed_at DESC,c.id DESC LIMIT 1) AS reviewed_hours
FROM stores s
WHERE s.beer_eligible AND s.is_published AND s.confidence_level<>'excluded'
  AND NOT EXISTS (SELECT 1 FROM place_corrections c
    WHERE c.source_name=s.source_name AND c.source_local_id=s.source_local_id
      AND c.normalized_name=s.normalized_name AND c.revoked_at IS NULL
      AND (c.valid_until IS NULL OR c.valid_until>now())
      AND c.kind IN ('closed_now','closed_permanently','no_beer'));

-- Down Migration
DROP VIEW serving_stores;
DROP TABLE place_corrections;
DROP TABLE place_reports;
ALTER TABLE stores DROP COLUMN osm_tags, DROP COLUMN osm_element_updated_at,
  DROP COLUMN beer_eligible, DROP COLUMN beer_evidence, DROP COLUMN beer_evidence_reason,
  DROP COLUMN hours_web_observed_at;
