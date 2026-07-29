import { nameSimilarity } from './sources/osm.js';

export const CENSO_MATCH_VERSION = 'censo-match-v2-high-precision';

export type CensoMatchCandidate = {
  osmId: number;
  censoId: number;
  censoSource: string;
  censoLocalId: string;
  distanceM: number;
  osmName: string;
  censoName: string;
  osmPlaceType: string;
  censoPlaceType: string;
};

export type CensoMatchMethod = 'exact_name' | 'strong_name' | 'name_and_type';

export type AcceptedCensoMatch = CensoMatchCandidate & {
  method: CensoMatchMethod;
  nameSimilarity: number;
  typeCompatible: boolean;
};

const TAKEAWAY_TYPES = new Set(['supermercado', 'alimentacion', 'bodega', 'tienda_24h']);

/**
 * Names that describe only a category are not identity evidence. Census
 * adapters often use the activity label when the trading name is absent.
 */
const GENERIC_NAMES = new Set([
  'ALIMENTACION',
  'ALIMENTACIO',
  'AUTOSERVEI',
  'BAR',
  'BARS',
  'BEGUDES',
  'BODEGA',
  'CAFE',
  'CAFETERIA',
  'ESTABLECIMIENTO DE BEBIDAS',
  'ESTABLIMENT DE BEGUDES',
  'RESTAURANT',
  'RESTAURANTE',
  'RESTAURANTS',
  'SUPERMERCAT',
  'SUPERMERCADO',
]);

const GENERIC_NAME_TOKENS = new Set([
  '24',
  '24H',
  'ALIMENTACION',
  'ALIMENTACIO',
  'AUTOSERVEI',
  'AUTOSERVICIO',
  'BAR',
  'BARS',
  'BAZAR',
  'BEBIDAS',
  'BEGUDES',
  'BODEGA',
  'CAFE',
  'CAFETERIA',
  'DE',
  'DEL',
  'ESTABLECIMIENTO',
  'ESTABLIMENT',
  'FRUTOS',
  'H',
  'I',
  'RESTAURANT',
  'RESTAURANTE',
  'RESTAURANTS',
  'SECOS',
  'SUPERMERCAT',
  'SUPERMERCADO',
  'TIENDA',
  'Y',
]);

export function isGenericPlaceName(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  if (!normalized) return false;
  if (GENERIC_NAMES.has(normalized)) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => GENERIC_NAME_TOKENS.has(token));
}

export function arePlaceTypesCompatible(osmType: string, censoType: string): boolean {
  if (osmType === censoType) return true;
  return TAKEAWAY_TYPES.has(osmType) && TAKEAWAY_TYPES.has(censoType);
}

/**
 * High-precision acceptance policy.
 *
 * Pure proximity never suffices. Every pair needs a non-generic name match and
 * a compatible functional type. An unnamed point remains OSM-only: address and
 * near-identical coordinates still do not prove identity in a dense building.
 */
export function evaluateCensoMatch(candidate: CensoMatchCandidate): AcceptedCensoMatch | null {
  if (
    !Number.isFinite(candidate.distanceM) ||
    candidate.distanceM < 0 ||
    candidate.distanceM > 30
  ) {
    return null;
  }

  const osmName = candidate.osmName.trim();
  const censoName = candidate.censoName.trim();
  const bothNamed = osmName !== '' && censoName !== '';
  const genericName = isGenericPlaceName(osmName) || isGenericPlaceName(censoName);
  const similarity = bothNamed && !genericName ? nameSimilarity(osmName, censoName) : 0;
  const typeCompatible = arePlaceTypesCompatible(candidate.osmPlaceType, candidate.censoPlaceType);

  let method: CensoMatchMethod | null = null;
  if (bothNamed && !genericName && typeCompatible && osmName === censoName) {
    method = 'exact_name';
  } else if (bothNamed && typeCompatible && similarity >= 0.8 && candidate.distanceM <= 20) {
    method = 'strong_name';
  } else if (bothNamed && similarity >= 0.6 && typeCompatible && candidate.distanceM <= 10) {
    method = 'name_and_type';
  }

  if (!method) return null;
  return {
    ...candidate,
    method,
    nameSimilarity: similarity,
    typeCompatible,
  };
}

/**
 * Keep only unambiguous one-to-one candidates. We do not choose a winner when
 * an OSM or censo row has several evidence-qualified partners; those cases
 * remain OSM-only until another signal can resolve the identity.
 */
export function selectHighPrecisionCensoMatches(
  candidates: readonly CensoMatchCandidate[],
): AcceptedCensoMatch[] {
  const accepted = candidates
    .map(evaluateCensoMatch)
    .filter((match): match is AcceptedCensoMatch => match !== null);

  const osmCounts = new Map<number, number>();
  const censoCounts = new Map<number, number>();

  for (const match of accepted) {
    osmCounts.set(match.osmId, (osmCounts.get(match.osmId) ?? 0) + 1);
    censoCounts.set(match.censoId, (censoCounts.get(match.censoId) ?? 0) + 1);
  }

  return accepted
    .filter((match) => osmCounts.get(match.osmId) === 1 && censoCounts.get(match.censoId) === 1)
    .sort((a, b) => a.osmId - b.osmId);
}
