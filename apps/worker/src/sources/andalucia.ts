// Directorio de empresas y establecimientos con actividad económica en Andalucía
// — Instituto de Estadística y Cartografía de Andalucía (IECA), Junta de
// Andalucía. CC BY 4.0. Point-level, per-establishment layer `estab_geo24`
// (NOT the aggregated statistical grid `gridestab24`), served through the IECA
// GeoServer as WFS. Covers the **8 provinces** of Andalusia (Sevilla, Málaga,
// Córdoba, Granada, Almería, Cádiz, Huelva, Jaén) — 288k establishments total,
// ~25k beer-relevant after the CNAE filter below. The WFS reprojects to WGS84
// for us (srsName=EPSG:4326), so no reprojection here.
// https://www.juntadeandalucia.es/institutodeestadisticaycartografia/dega/directorio-de-empresas-y-establecimientos-con-actividad-economica-en-andalucia
import {
  type PlaceType,
  type ScoreOutput,
  levelFromScore,
  matchesChainPattern,
  normalize,
} from '../scoring/v2.js';

export const ANDALUCIA_SOURCE_NAME = 'censo_andalucia';

export const ANDALUCIA_SCORING_VERSION = 'censo-andalucia-v1';

/** Local cache file name (layer/edition-pinned; bump when a new year lands). */
export const ANDALUCIA_GEOJSON_FILE = 'andalucia-estab-2024.geojson';

const WFS_BASE =
  'https://www.juntadeandalucia.es/institutodeestadisticaycartografia/geoserver-ieca/gridestab/wfs';

/** Point layer (individual establishments), 2024 edition. */
const WFS_TYPENAME = 'gridestab:estab_geo24';

/**
 * Beer-relevant CNAE-2009 codes → place_type. Like the Barcelona city census
 * (a finite activity-code list), IECA classifies every premise with a 4-digit
 * CNAE, so classification is a pure lookup — no free-text scoring. Everything
 * not in this map (offices, workshops, pharmacies, …) is skipped. Fuel stations
 * (CNAE 4730) are intentionally excluded: OSM covers gasolineras nationally with
 * a shop/hours gate. 2024 counts (all Andalusia) in comments.
 */
export const ANDALUCIA_CNAE_PLACE_TYPE: Record<string, PlaceType> = {
  '5630': 'bar', // Establecimientos de bebidas — bars (8,938)
  '5610': 'bar', // Restaurantes y puestos de comidas (7,301)
  '4711': 'supermercado', // Comercio al por menor no especializado, predominio alimentación (4,963)
  '4725': 'bodega', // Comercio al por menor de bebidas (195)
  '4721': 'alimentacion', // Frutas y hortalizas (429)
  '4722': 'alimentacion', // Carne y productos cárnicos (964)
  '4723': 'alimentacion', // Pescados y mariscos (367)
  '4724': 'alimentacion', // Pan, pastelería y confitería (1,448)
  '4729': 'alimentacion', // Otros productos alimenticios en establecimientos especializados (650)
};

/**
 * Full WFS GetFeature URL for the beer-relevant subset, WGS84, GeoJSON. The
 * CQL filter is derived from ANDALUCIA_CNAE_PLACE_TYPE so the download and the
 * classifier can never drift apart. Verified 2026-07: returns all ~25k matches
 * in one response (no server cap), ~14 MB.
 */
export const ANDALUCIA_WFS_URL = ((): string => {
  const codes = Object.keys(ANDALUCIA_CNAE_PLACE_TYPE)
    .map((c) => `'${c}'`)
    .join(',');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: WFS_TYPENAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `cnae IN (${codes})`,
  });
  return `${WFS_BASE}?${params.toString()}`;
})();

/** The `estab_geo24` feature properties the adapter reads. */
export type AndaluciaProps = {
  id: number | string;
  razon_social: string | null;
  domicilio: string | null;
  codpos: string | null;
  provincia: string | null;
  codmun: string | null;
  nombre_mun: string | null;
  cnae: string;
  actividad: string | null;
  sector_actividad: string | null;
};

// Mirror of v2's base scores for the types this adapter emits: an official
// directory entry is a strong signal, same footing as a Madrid epigraph.
const BASE_SCORE: Record<string, number> = {
  bar: 90,
  supermercado: 85,
  bodega: 85,
  alimentacion: 75,
};

export type AndaluciaClassified = ScoreOutput & { placeType: PlaceType };

/** Classify one establishment by its CNAE. Null → not beer-relevant (skipped). */
export function classifyAndaluciaPremise(input: {
  cnae: string;
  name: string;
  chainPatterns: readonly string[];
}): AndaluciaClassified | null {
  const placeType = ANDALUCIA_CNAE_PLACE_TYPE[input.cnae?.trim()];
  if (!placeType) return null;

  const sellsOnsiteBeer = placeType === 'bar';
  const sellsTakeawayBeer = placeType !== 'bar';
  const score = BASE_SCORE[placeType] ?? 35;

  return {
    score,
    level: levelFromScore(score),
    placeType,
    sellsTakeawayBeer,
    sellsOnsiteBeer,
    isChain: matchesChainPattern(normalize(input.name), input.chainPatterns),
    badges: [
      placeType as string,
      ...(sellsTakeawayBeer ? ['vende_cerveza_para_llevar'] : []),
      ...(sellsOnsiteBeer ? ['vende_cerveza_in_situ'] : []),
      'horario_no_confirmado', // the directory has no opening hours
    ],
    scoringVersion: ANDALUCIA_SCORING_VERSION,
  };
}

/** Display name: business name (razón social), else the activity label. */
export function andaluciaDisplayName(props: AndaluciaProps): string {
  const name = props.razon_social?.trim();
  if (name) return name;
  return props.actividad?.trim() ?? '';
}
