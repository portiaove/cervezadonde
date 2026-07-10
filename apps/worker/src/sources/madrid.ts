// Constants for the Censo de Locales y Actividades dataset.
// Schema PDF: 200085-9-censo-locales.pdf (Ayuntamiento de Madrid, mar/2022).

// Official censos follow the censo_<city> scheme so the OSM enrichment step
// can match any of them with source_name LIKE 'censo_%' (ADR-007).
export const MADRID_SOURCE_NAME = 'censo_madrid';

export const MADRID_CSV_ENCODING = 'utf-8';
// NB: the schema PDF (mar/2022) says "|", but the actual file uses ";".
// Confirmed by diagnose:madrid against the live dataset.
export const MADRID_CSV_DELIMITER = ';';

// EPSG:25830 — ETRS89 UTM zone 30N. ED-50 prior to 2017-09-15, irrelevant for us.
export const MADRID_COORDS_SRID = 25830;

// Field name as declared in the schema PDF (Actividades file).
// Order matters only as documentation; csv-parse maps by header name.
export const MADRID_ACTIVIDADES_COLUMNS = [
  'id_local',
  'id_distrito_local',
  'desc_distrito_local',
  'id_barrio_local',
  'desc_barrio_local',
  'cod_barrio_local',
  'id_seccion_censal_local',
  'desc_seccion_censal_local',
  'coordenada_x_local',
  'coordenada_y_local',
  'id_tipo_acceso_local',
  'desc_tipo_acceso_local',
  'id_situacion_local',
  'desc_situacion_local',
  'id_vial_edificio',
  'clase_vial_edificio',
  'desc_vial_edificio',
  'id_ndp_edificio',
  'id_clase_ndp_edificio',
  'nom_edificio',
  'num_edificio',
  'cal_edificio',
  'secuencial_local_PC',
  'id_vial_acceso',
  'clase_vial_acceso',
  'desc_vial_acceso',
  'id_ndp_acceso',
  'id_clase_ndp_acceso',
  'nom_acceso',
  'num_acceso',
  'cal_acceso',
  'coordenada_x_agrupacion',
  'coordenada_y_agrupacion',
  'id_agrupacion',
  'nombre_agrupacion',
  'id_tipo_agrup',
  'desc_tipo_agrup',
  'id_planta_agrupado',
  'id_local_agrupado',
  'rotulo',
  'id_seccion',
  'desc_seccion',
  'id_division',
  'desc_division',
  // Schema PDF lists this as 'ide_epigrafe' but the live file uses 'id_epigrafe'.
  'id_epigrafe',
  'desc_epigrafe',
  // Undocumented in the schema PDF but present in the file: load timestamp.
  'fx_carga',
] as const;

export type MadridActividadColumn = (typeof MADRID_ACTIVIDADES_COLUMNS)[number];

// id_tipo_acceso_local values from the schema PDF.
export const TIPO_ACCESO = {
  AGRUPADO: '0',
  PUERTA_CALLE: '1',
  PUERTA_CALLE_ASOCIADO: '12',
} as const;

// id_situacion_local values.
export const SITUACION = {
  ABIERTO: '1',
  CERRADO: '4',
  USO_VIVIENDA: '5',
  OBRAS: '7',
  BAJA: '8',
  BAJA_R: '9',
} as const;

export const SITUACION_EXCLUDED: ReadonlySet<string> = new Set([
  SITUACION.USO_VIVIENDA,
  SITUACION.BAJA,
  SITUACION.BAJA_R,
]);

export function getMadridUrls(): { locales: string; actividades: string } {
  const locales = process.env.MADRID_CENSO_LOCALES_URL;
  const actividades = process.env.MADRID_CENSO_ACTIVIDADES_URL;
  if (!locales || !actividades) {
    throw new Error(
      'MADRID_CENSO_LOCALES_URL and MADRID_CENSO_ACTIVIDADES_URL must be set (see .env.example).',
    );
  }
  return { locales, actividades };
}

export function getCacheDir(): string {
  return process.env.MADRID_CACHE_DIR ?? './data/raw';
}
