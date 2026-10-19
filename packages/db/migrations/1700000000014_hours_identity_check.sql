-- Up Migration
-- A fetch attempt is not a new observation of a valid branch-specific value.
-- Keep the old value for audit, but do not retry a failed legacy candidate on
-- every run merely because its observation date correctly remains null.
ALTER TABLE stores ADD COLUMN hours_web_check_version text;

-- Down Migration
ALTER TABLE stores DROP COLUMN hours_web_check_version;
