// Beer-pivot scorer. See docs/07-scoring-classification.md.
//
// Pure function: given Censo + (optional) OSM tags + chain list + name,
// derive place_type, sells_*_beer booleans, confidence score and badges.
//
// Open-now is intentionally NOT decided here — that's an API-side concern
// (see apps/api/src/openNow.ts in M6e + ADR-004).

import { isBarEpigraph } from './epigraphs.js';

export const SCORING_VERSION = 'v2-beer';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'excluded';
export type PlaceType =
  | 'bar'
  | 'supermercado'
  | 'alimentacion'
  | 'bodega'
  | 'tienda_24h'
  | 'otro';

export type ScoreInput = {
  name: string;
  epigraphCodes: readonly string[];
  officialStatus: string | null;
  openingHoursOsm: string | null;
  /** Lower-case keys; values verbatim from OSM. Optional in M6c, populated in M6g. */
  osmTags?: Record<string, string>;
  /** Word-boundary chain patterns (normalised, upper-case). Informational only. */
  chainPatterns: readonly string[];
};

export type ScoreOutput = {
  score: number;
  level: ConfidenceLevel;
  placeType: PlaceType;
  sellsTakeawayBeer: boolean;
  sellsOnsiteBeer: boolean;
  isChain: boolean;
  badges: string[];
  scoringVersion: string;
};

// --- constants -------------------------------------------------------------

const PLACE_TYPE_BASE_SCORE: Record<PlaceType, number> = {
  tienda_24h: 95,
  bar: 90,
  supermercado: 85,
  bodega: 85,
  alimentacion: 75,
  otro: 35,
};

const NAME_HINT_BAR = ['BAR', 'TABERNA', 'CERVEZA', 'CERVECERIA', 'PUB', 'IRLANDES'];
const NAME_HINT_24H = ['24H', '24 HORAS'];
const NAME_HINT_BODEGA = ['BODEGA', 'VINOS'];
const NAME_HINT_SHOP = ['ALIMENTACION', 'MINI MARKET', 'MINIMARKET', 'ULTRAMARINOS'];
const NAME_NEGATIVE_BAR = ['CONFITERIA', 'HELADERIA', 'PANADERIA', 'PASTELERIA'];

const SHOP_EPIGRAPHS_FOR_ALIMENTACION = new Set([
  '471101',
  '471104',
  '472911',
  '472501',
]);

const CLOSED_STATUS_KEYWORDS = ['BAJA', 'CERRADO', 'INACTIVO', 'ANULAD', 'USO VIVIENDA'];

const TAKEAWAY_PLACE_TYPES: ReadonlySet<PlaceType> = new Set<PlaceType>([
  'supermercado',
  'alimentacion',
  'bodega',
  'tienda_24h',
]);

const OSM_SHOP_TAKEAWAY = new Set([
  'alcohol',
  'convenience',
  'supermarket',
  'general',
  'kiosk',
  'wine',
]);

const OSM_AMENITY_ONSITE = new Set([
  'bar',
  'pub',
  'cafe',
  'restaurant',
  'fast_food',
]);

const PLACE_TYPE_TO_BADGE: Record<PlaceType, string | null> = {
  bar: 'bar',
  supermercado: 'supermercado',
  alimentacion: 'alimentacion',
  bodega: 'bodega',
  tienda_24h: 'tienda_24h',
  otro: null,
};

// --- utilities -------------------------------------------------------------

export const normalize = (s: string | null | undefined): string => {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => haystack.includes(n));

const matchesChainPattern = (
  normalizedName: string,
  patterns: readonly string[],
): boolean => {
  if (!normalizedName || patterns.length === 0) return false;
  return patterns.some((raw) => {
    const p = normalize(raw);
    if (!p) return false;
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(normalizedName);
  });
};

const isOfficiallyClosed = (status: string | null): boolean => {
  const s = normalize(status);
  if (!s) return false;
  return CLOSED_STATUS_KEYWORDS.some((k) => s.includes(k));
};

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, n));

const levelFromScore = (score: number): ConfidenceLevel => {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  if (score >= 30) return 'low';
  return 'excluded';
};

const lower = (s: string | undefined): string => (s ?? '').toLowerCase().trim();

// --- derivations -----------------------------------------------------------

const derivePlaceType = (input: {
  epigraphCodes: readonly string[];
  normalizedName: string;
  osmTags?: Record<string, string>;
  isChain: boolean;
}): PlaceType => {
  const { epigraphCodes, normalizedName, osmTags, isChain } = input;

  // 1. OSM explicit signals take priority — they are the most current.
  if (osmTags) {
    const amenity = lower(osmTags.amenity);
    if (amenity === 'bar' || amenity === 'pub') return 'bar';
    const shop = lower(osmTags.shop);
    if (shop === 'alcohol' || shop === 'wine') return 'bodega';
    if (shop === 'supermarket') return 'supermercado';
  }

  // 2. Bar epigraph from Censo.
  if (epigraphCodes.some(isBarEpigraph)) return 'bar';

  // 3. OSM cafe/restaurant — promote to bar, UNLESS the rotulo signals this
  //    is actually a bakery / pastry shop with a coffee corner. OSM tags are
  //    noisy on the cafe/restaurant axis and the rotulo is the strongest signal.
  if (osmTags) {
    const amenity = lower(osmTags.amenity);
    if (amenity === 'cafe' || amenity === 'restaurant') {
      if (!containsAny(normalizedName, NAME_NEGATIVE_BAR)) return 'bar';
      // fall through — let the rest of the rules classify (probably 'otro').
    }
  }

  // 4. Chains land in supermercado.
  if (isChain) return 'supermercado';

  // 5. 24h indicators.
  if (
    epigraphCodes.includes('471103') ||
    containsAny(normalizedName, NAME_HINT_24H)
  ) {
    return 'tienda_24h';
  }

  // 6. Bodega indicators.
  if (
    epigraphCodes.includes('472502') ||
    containsAny(normalizedName, NAME_HINT_BODEGA)
  ) {
    return 'bodega';
  }

  // 7. Alimentación / ultramarinos / minimarket.
  if (
    epigraphCodes.some((c) => SHOP_EPIGRAPHS_FOR_ALIMENTACION.has(c)) ||
    containsAny(normalizedName, NAME_HINT_SHOP)
  ) {
    return 'alimentacion';
  }

  return 'otro';
};

const deriveSellsTakeawayBeer = (input: {
  placeType: PlaceType;
  normalizedName: string;
  osmTags?: Record<string, string>;
}): boolean => {
  const { placeType, normalizedName, osmTags } = input;
  if (TAKEAWAY_PLACE_TYPES.has(placeType)) return true;
  if (
    containsAny(normalizedName, NAME_HINT_BODEGA) ||
    containsAny(normalizedName, NAME_HINT_SHOP) ||
    normalizedName.includes('CERVEZA')
  ) {
    return true;
  }
  const shop = lower(osmTags?.shop);
  if (shop && OSM_SHOP_TAKEAWAY.has(shop)) return true;
  return false;
};

const deriveSellsOnsiteBeer = (input: {
  placeType: PlaceType;
  normalizedName: string;
  osmTags?: Record<string, string>;
}): boolean => {
  const { placeType, normalizedName, osmTags } = input;
  if (placeType === 'bar') return true;
  const amenity = lower(osmTags?.amenity);
  if (amenity && OSM_AMENITY_ONSITE.has(amenity)) {
    if (containsAny(normalizedName, NAME_NEGATIVE_BAR)) return false;
    return true;
  }
  return false;
};

const deriveBadges = (input: {
  placeType: PlaceType;
  sellsTakeawayBeer: boolean;
  sellsOnsiteBeer: boolean;
  hasHours: boolean;
}): string[] => {
  const { placeType, sellsTakeawayBeer, sellsOnsiteBeer, hasHours } = input;
  const badges = new Set<string>();
  const placeBadge = PLACE_TYPE_TO_BADGE[placeType];
  if (placeBadge) badges.add(placeBadge);
  if (sellsTakeawayBeer) badges.add('vende_cerveza_para_llevar');
  if (sellsOnsiteBeer) badges.add('vende_cerveza_in_situ');
  if (!hasHours) badges.add('horario_no_confirmado');
  return [...badges];
};

// --- main entry ------------------------------------------------------------

export function scoreCandidate(input: ScoreInput): ScoreOutput {
  const normalizedName = normalize(input.name);
  const isChain = matchesChainPattern(normalizedName, input.chainPatterns);

  // Hard exclusion: officially closed / vivienda / baja.
  if (isOfficiallyClosed(input.officialStatus)) {
    return {
      score: 0,
      level: 'excluded',
      placeType: 'otro',
      sellsTakeawayBeer: false,
      sellsOnsiteBeer: false,
      isChain,
      badges: ['posible_cerrado', 'horario_no_confirmado'],
      scoringVersion: SCORING_VERSION,
    };
  }

  const placeType = derivePlaceType({
    epigraphCodes: input.epigraphCodes,
    normalizedName,
    osmTags: input.osmTags,
    isChain,
  });

  let score = PLACE_TYPE_BASE_SCORE[placeType];

  // Opening hours bonus.
  const hoursTrimmed = (input.openingHoursOsm ?? '').trim();
  const hasHours = hoursTrimmed.length > 0;
  if (hasHours) score += 15;
  if (hoursTrimmed === '24/7') score += 10;

  // Name hints.
  if (containsAny(normalizedName, NAME_HINT_BAR)) score += 5;
  if (containsAny(normalizedName, NAME_HINT_24H)) score += 5;
  if (containsAny(normalizedName, NAME_HINT_BODEGA)) score += 5;
  if (containsAny(normalizedName, NAME_HINT_SHOP)) score += 5;

  // OSM enrichment.
  const shop = lower(input.osmTags?.shop);
  if (shop && ['convenience', 'alcohol', 'supermarket'].includes(shop)) {
    score += 5;
  }
  const amenity = lower(input.osmTags?.amenity);
  if (amenity && ['bar', 'pub'].includes(amenity)) {
    score += 5;
  }

  // 'otro' with no positive signal at all → hard down.
  const hasAnySignal =
    placeType !== 'otro' ||
    containsAny(normalizedName, NAME_HINT_BAR) ||
    containsAny(normalizedName, NAME_HINT_24H) ||
    containsAny(normalizedName, NAME_HINT_BODEGA) ||
    containsAny(normalizedName, NAME_HINT_SHOP) ||
    Boolean(shop) ||
    Boolean(amenity);
  if (placeType === 'otro' && !hasAnySignal) score -= 100;

  score = clamp(score);

  const sellsTakeawayBeer = deriveSellsTakeawayBeer({
    placeType,
    normalizedName,
    osmTags: input.osmTags,
  });
  const sellsOnsiteBeer = deriveSellsOnsiteBeer({
    placeType,
    normalizedName,
    osmTags: input.osmTags,
  });

  const badges = deriveBadges({
    placeType,
    sellsTakeawayBeer,
    sellsOnsiteBeer,
    hasHours,
  });

  return {
    score,
    level: levelFromScore(score),
    placeType,
    sellsTakeawayBeer,
    sellsOnsiteBeer,
    isChain,
    badges,
    scoringVersion: SCORING_VERSION,
  };
}
