-- Up Migration

-- Align staging_madrid_actividades with the actual Madrid census CSV shape,
-- discovered via worker:diagnose:madrid. The published schema PDF (mar/2022)
-- had a typo on ide_epigrafe and did not document fx_carga.

ALTER TABLE staging_madrid_actividades
  RENAME COLUMN ide_epigrafe TO id_epigrafe;

ALTER TABLE staging_madrid_actividades
  ADD COLUMN fx_carga TEXT;

-- Down Migration

ALTER TABLE staging_madrid_actividades DROP COLUMN fx_carga;
ALTER TABLE staging_madrid_actividades RENAME COLUMN id_epigrafe TO ide_epigrafe;
