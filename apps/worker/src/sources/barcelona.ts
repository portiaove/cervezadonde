// Cens d'activitats econòmiques en planta baixa — Ajuntament de Barcelona,
// Open Data BCN, CC BY 4.0. 2024 edition (one row per ground-floor premise;
// ID_Global is unique — verified over the 68,024-row file).
// https://opendata-ajuntament.barcelona.cat/data/ca/dataset/cens-locals-planta-baixa-act-economica

import {
  type PlaceType,
  type ScoreOutput,
  levelFromScore,
  matchesChainPattern,
  normalize,
} from '../scoring/v2.js';

export const BARCELONA_SOURCE_NAME = 'censo_barcelona';

export const BARCELONA_CSV_URL =
  'https://opendata-ajuntament.barcelona.cat/data/dataset/fe177673-0f83-42e7-b35a-ddea901be8bc/resource/38babeec-5c47-43d3-84e7-b13a4b89004f/download/241021_censcomercialbcn_opendata_2024_v5.csv';

/** Local cache file name (edition-pinned; bump when a new census lands). */
export const BARCELONA_CSV_FILE = 'barcelona-cens-2024.csv';

export const BARCELONA_SCORING_VERSION = 'censo-bcn-v1';

/** The CSV columns the adapter reads (comma-delimited, UTF-8 BOM, WGS84). */
export type BcnRow = {
  ID_Global: string;
  Codi_Activitat_2022: string;
  Nom_Activitat: string;
  Nom_Local: string;
  SN_Obert24h: string;
  SN_Servei_Degustacio: string;
  Latitud: string;
  Longitud: string;
  Nom_Via: string;
  Num_Policia_Inicial: string;
  Lletra_Inicial: string;
  Num_Policia_Final: string;
  Lletra_Final: string;
  Nom_Barri: string;
  Nom_Districte: string;
};

/**
 * Beer-relevant activity codes → place_type. Unlike Madrid (free-text
 * epigraphs + name heuristics), the BCN census classifies every premise with
 * a finite code list (Codi_Activitat_2022), so classification is a lookup.
 * Everything not in this map (offices, hairdressers, empty premises, …) is
 * skipped. 2024 counts in comments.
 */
export const BCN_ACTIVITY_PLACE_TYPE: Record<string, PlaceType> = {
  '1400001': 'bar', // Bars / cibercafè (4,273)
  '1400002': 'bar', // Restaurants (4,430)
  '1400003': 'bar', // Menjar take away / menjar ràpid (778) — OSM parity: fast_food counts as onsite
  '1400000': 'bar', // Serveis de menjar i begudes, genèric (74)
  '1000020': 'supermercado', // Autoservei / Supermercat (2,594)
  '1001000': 'bodega', // Begudes (272)
  '1000030': 'alimentacion', // Quotidià alimentari — Altres (540): colmados/badulaques
  '1000000': 'alimentacion', // Resta alimentació (2)
};

// Mirror of v2's PLACE_TYPE_BASE_SCORE for the types this adapter can emit:
// an official census code is a strong signal, same footing as a Madrid epigraph.
const BASE_SCORE: Record<string, number> = {
  tienda_24h: 95,
  bar: 90,
  supermercado: 85,
  bodega: 85,
  alimentacion: 75,
};

export type BcnClassified = ScoreOutput & { placeType: PlaceType };

/**
 * Classify one census row. Returns null when the activity is not
 * beer-relevant (the row is skipped entirely).
 */
export function classifyBcnPremise(input: {
  activityCode: string;
  name: string;
  open24h: boolean;
  /** SN_Servei_Degustacio: shop licensed to serve on the premises. */
  degustacio: boolean;
  chainPatterns: readonly string[];
}): BcnClassified | null {
  const mapped = BCN_ACTIVITY_PLACE_TYPE[input.activityCode];
  if (!mapped) return null;

  // The census carries an explicit 24h flag (Madrid infers it from names).
  const placeType: PlaceType = input.open24h && mapped !== 'bar' ? 'tienda_24h' : mapped;

  const sellsOnsiteBeer = placeType === 'bar' || input.degustacio;
  const sellsTakeawayBeer = placeType !== 'bar';

  const score = BASE_SCORE[placeType] ?? 35;
  const badges = [
    placeType as string,
    ...(sellsTakeawayBeer ? ['vende_cerveza_para_llevar'] : []),
    ...(sellsOnsiteBeer ? ['vende_cerveza_in_situ'] : []),
    'horario_no_confirmado', // the census has no opening hours
  ];

  return {
    score,
    level: levelFromScore(score),
    placeType,
    sellsTakeawayBeer,
    sellsOnsiteBeer,
    isChain: matchesChainPattern(normalize(input.name), input.chainPatterns),
    badges,
    scoringVersion: BARCELONA_SCORING_VERSION,
  };
}

/** "GAIARRE 84-88" from the street fields; null when there is no street. */
export function composeBcnAddress(row: BcnRow): string | null {
  const via = row.Nom_Via?.trim();
  if (!via) return null;
  const first = `${row.Num_Policia_Inicial ?? ''}${row.Lletra_Inicial ?? ''}`.trim();
  const last = `${row.Num_Policia_Final ?? ''}${row.Lletra_Final ?? ''}`.trim();
  const numbers = first && last && last !== first ? `${first}-${last}` : first || '';
  return numbers ? `${via} ${numbers}` : via;
}

/**
 * Premise display name. 'SN' means "sense nom"; fall back to the activity
 * label ("Bars", "Autoservei / Supermercat") — descriptive beats a cryptic
 * placeholder on the map.
 */
export function bcnDisplayName(row: BcnRow): string {
  const name = row.Nom_Local?.trim();
  if (!name || name.toUpperCase() === 'SN') return row.Nom_Activitat?.trim() ?? '';
  return name;
}
