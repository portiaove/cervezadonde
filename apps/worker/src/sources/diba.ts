// Cens municipal d'activitats i establiments (GIA) — Diputació de Barcelona,
// served through the Catalan open-data portal (Socrata) so the FULL dataset is
// downloadable (the do.diba.cat API caps at 1000 rows with no working paging).
// CC BY 4.0, refreshed daily, ~42k establishments across 189 municipalities of
// the Barcelona province (the metro belt — Barcelona CITY is NOT here, it has
// its own census: see sources/barcelona.ts). Point coordinates are WGS84
// (latitud/longitud), so no reprojection.
// https://analisi.transparenciacatalunya.cat/Comer-/Cens-d-activitats-municipal-amb-establiment-GIA-DI/txvw-xc3g
import {
  type PlaceType,
  type ScoreOutput,
  levelFromScore,
  matchesChainPattern,
  normalize,
} from '../scoring/v2.js';

export const DIBA_SOURCE_NAME = 'censo_diba';

// Socrata CSV export. $limit lifts the default 1000-row cap over the whole
// ~42k dataset (well under Socrata's 50k no-token ceiling).
export const DIBA_CSV_URL =
  'https://analisi.transparenciacatalunya.cat/resource/txvw-xc3g.csv?$limit=60000';

export const DIBA_CSV_FILE = 'diba-establiments.csv';

export const DIBA_SCORING_VERSION = 'censo-diba-v1';

/** The Socrata columns the adapter reads (lower-cased, comma CSV, WGS84). */
export type DibaRow = {
  codi_ens: string;
  nom_ens: string;
  identificador: string;
  descripcio_activitat: string;
  nom_comercial: string;
  adreca_complerta: string;
  sector_economic: string;
  latitud: string;
  longitud: string;
};

const BASE_SCORE: Record<string, number> = {
  bar: 90,
  supermercado: 85,
  bodega: 85,
  alimentacion: 75,
};

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();

/**
 * Classify a GIA establishment from its free-text activity description.
 *
 * Unlike the Barcelona city census (a finite municipal code list), GIA carries
 * only a messy Catalan free-text activity — NACE is section-letter coarse and
 * CCAE is 92% empty — so classification is keyword-based, and deliberately
 * conservative: only clearly beer-relevant activities map, everything else
 * (offices, hairdressers, tourist flats, clothing, pharmacies, generic "comerç
 * al detall", …) is skipped. Word-token matching, so BAR ≠ BARBERIA.
 * Fuel stations are intentionally left out (OSM covers gasolineras nationally
 * with a shop/hours gate; GIA lacks that signal).
 */
export function classifyDibaActivity(descripcio: string): PlaceType | null {
  const n = norm(descripcio);
  if (!n) return null;
  const tokens = new Set(n.split(' '));
  const tok = (...ws: string[]): boolean => ws.some((w) => tokens.has(w));
  const has = (sub: string): boolean => n.includes(sub);

  // barra — bars, restaurants, cafés (tourist accommodation in the same GIA
  // "hostaleria" sector carries none of these tokens, so it's excluded).
  if (
    tok(
      'BAR',
      'RESTAURANT',
      'RESTAURANTS',
      'CAFETERIA',
      'CAFE',
      'CAFES',
      'PIZZERIA',
      'CERVESERIA',
      'TAVERNA',
      'HAMBURGUESERIA',
      'CREPERIA',
      'BRASSERIA',
      'ENTREPANS',
    ) ||
    has('ESTABLIMENTS DE MENJAR') ||
    has('MENJAR RAPID') ||
    has('MENJAR PER EMPORTAR')
  ) {
    return 'bar';
  }

  // supermercado
  if (tok('SUPERMERCAT', 'HIPERMERCAT', 'AUTOSERVEI')) return 'supermercado';

  // bodega — drink-focused retail only, not a general grocery that merely lists
  // "begudes" among its goods, and not wine PRODUCTION/vineyards.
  if (
    tok('BEGUDES', 'CELLER', 'VINOTECA', 'VINS', 'CAVES') &&
    !has('ALIMENT') &&
    !has('ELABORACIO') &&
    !has('CONREU') &&
    !has('FABRICACIO')
  ) {
    return 'bodega';
  }

  // alimentacion — specific food retail (butcher, bakery, greengrocer, deli…).
  if (
    tok(
      'ALIMENTACIO',
      'ALIMENTARIS',
      'ALIMENTS',
      'QUEVIURES',
      'COLMADO',
      'CARNISSERIA',
      'CARN',
      'CANSALADERIA',
      'XARCUTERIA',
      'PEIXATERIA',
      'PEIX',
      'FRUITERIA',
      'FRUITA',
      'FRUITES',
      'VERDURES',
      'FORN',
      'FLECA',
      'PASTISSERIA',
      'CONFITERIA',
      'ROSTISSERIA',
      'FORMATGES',
    ) ||
    has('PRODUCTES ALIMENTARIS')
  ) {
    return 'alimentacion';
  }

  return null;
}

export type DibaClassified = ScoreOutput & { placeType: PlaceType };

/** Full classification (place type + sell flags + score + chain) or null. */
export function classifyDibaPremise(input: {
  descripcio: string;
  name: string;
  chainPatterns: readonly string[];
}): DibaClassified | null {
  const placeType = classifyDibaActivity(input.descripcio);
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
      'horario_no_confirmado', // GIA has no opening hours
    ],
    scoringVersion: DIBA_SCORING_VERSION,
  };
}

/** Municipality name from "Ajuntament de X" / "Ajuntament d'X". */
export function dibaMunicipi(row: DibaRow): string | null {
  const ens = row.nom_ens?.trim();
  if (!ens) return null;
  return ens.replace(/^Ajuntament\s+(de\s+|d')/i, '').trim() || null;
}

/** Display name: commercial name, else the activity label. */
export function dibaDisplayName(row: DibaRow): string {
  const name = row.nom_comercial?.trim();
  if (name) return name;
  return row.descripcio_activitat?.trim() ?? '';
}
