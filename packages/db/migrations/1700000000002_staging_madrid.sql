-- Up Migration

-- Staging table for the denormalized Madrid "Actividades" CSV.
-- One row per (local, epigraph). All columns kept as TEXT so the staging step
-- never fails on malformed numbers; the transform step coerces and validates.
-- Truncated at the start of every import run.

CREATE TABLE staging_madrid_actividades (
  id                          BIGSERIAL PRIMARY KEY,
  id_local                    TEXT,
  id_distrito_local           TEXT,
  desc_distrito_local         TEXT,
  id_barrio_local             TEXT,
  desc_barrio_local           TEXT,
  cod_barrio_local            TEXT,
  id_seccion_censal_local     TEXT,
  desc_seccion_censal_local   TEXT,
  coordenada_x_local          TEXT,
  coordenada_y_local          TEXT,
  id_tipo_acceso_local        TEXT,
  desc_tipo_acceso_local      TEXT,
  id_situacion_local          TEXT,
  desc_situacion_local        TEXT,
  id_vial_edificio            TEXT,
  clase_vial_edificio         TEXT,
  desc_vial_edificio          TEXT,
  id_ndp_edificio             TEXT,
  id_clase_ndp_edificio       TEXT,
  nom_edificio                TEXT,
  num_edificio                TEXT,
  cal_edificio                TEXT,
  secuencial_local_pc         TEXT,
  id_vial_acceso              TEXT,
  clase_vial_acceso           TEXT,
  desc_vial_acceso            TEXT,
  id_ndp_acceso               TEXT,
  id_clase_ndp_acceso         TEXT,
  nom_acceso                  TEXT,
  num_acceso                  TEXT,
  cal_acceso                  TEXT,
  coordenada_x_agrupacion     TEXT,
  coordenada_y_agrupacion     TEXT,
  id_agrupacion               TEXT,
  nombre_agrupacion           TEXT,
  id_tipo_agrup               TEXT,
  desc_tipo_agrup             TEXT,
  id_planta_agrupado          TEXT,
  id_local_agrupado           TEXT,
  rotulo                      TEXT,
  id_seccion                  TEXT,
  desc_seccion                TEXT,
  id_division                 TEXT,
  desc_division               TEXT,
  ide_epigrafe                TEXT,
  desc_epigrafe               TEXT,
  -- Capture anything the schema PDF didn't mention so we can spot drift.
  raw_extra                   JSONB
);

CREATE INDEX staging_madrid_actividades_id_local_idx
  ON staging_madrid_actividades (id_local);

COMMENT ON TABLE staging_madrid_actividades IS
  'Raw rows from Censo de Locales (Actividades file). Truncated each import run.';

-- Down Migration

DROP TABLE IF EXISTS staging_madrid_actividades;
