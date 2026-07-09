// OpenStreetMap opening-hours enrichment source (ADR-005, doc 06 §B).
//
// OSM is our first-class source of `opening_hours`. We pull bars and shops
// for the Madrid bbox via Overpass, match them to Censo `stores` by spatial
// proximity + name similarity, and materialise the hours string onto stores.
//
// Everything here is pure/config: the Overpass query, the tag filters, and
// the name-similarity used for matching. The pipeline lives in ingest-osm.ts.

export const OSM_SOURCE_NAME = 'osm';

/** amenity values we treat as on-site (barra) beer candidates. */
export const OSM_AMENITY_VALUES = ['bar', 'pub', 'cafe', 'restaurant', 'fast_food'] as const;

/** shop values we treat as takeaway (lata) beer candidates. */
export const OSM_SHOP_VALUES = [
  'convenience',
  'alcohol',
  'supermarket',
  'general',
  'kiosk',
] as const;

export type OverpassConfig = {
  url: string;
  /** [south, west, north, east] in WGS84. */
  bbox: [number, number, number, number];
  timeoutSec: number;
};

export function getOverpassConfig(): OverpassConfig {
  const url = process.env.OSM_OVERPASS_URL;
  if (!url) throw new Error('OSM_OVERPASS_URL must be set (see .env.example).');

  const raw = process.env.OSM_BBOX;
  if (!raw) throw new Error('OSM_BBOX must be set (see .env.example).');
  const parts = raw.split(',').map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`OSM_BBOX must be "south,west,north,east" in WGS84; got "${raw}".`);
  }
  const [south, west, north, east] = parts as [number, number, number, number];
  if (south >= north || west >= east) {
    throw new Error(`OSM_BBOX is not a valid box: "${raw}".`);
  }

  const timeoutSec = Number.parseInt(process.env.OSM_OVERPASS_TIMEOUT ?? '180', 10);

  return { url, bbox: [south, west, north, east], timeoutSec };
}

/**
 * Build the Overpass QL query for the given bbox. `nwr` matches nodes, ways
 * and relations; `out center tags` returns tags plus a single representative
 * coordinate (center for ways/relations, lat/lon for nodes).
 */
export function buildOverpassQuery(cfg: OverpassConfig): string {
  const [s, w, n, e] = cfg.bbox;
  const bbox = `${s},${w},${n},${e}`;
  const amenity = OSM_AMENITY_VALUES.join('|');
  const shop = OSM_SHOP_VALUES.join('|');
  return [
    `[out:json][timeout:${cfg.timeoutSec}];`,
    '(',
    `  nwr["amenity"~"^(${amenity})$"](${bbox});`,
    `  nwr["shop"~"^(${shop})$"](${bbox});`,
    ');',
    'out center tags;',
  ].join('\n');
}

// --- Overpass response shape ----------------------------------------------

export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements: OverpassElement[];
};

/** A parsed, geolocated OSM place ready for matching. */
export type OsmPlace = {
  osmId: number;
  osmType: 'node' | 'way' | 'relation';
  /** Explicit source_local_id (e.g. osmium 'n123'); falls back to `${osmType}/${osmId}`. */
  sourceLocalId?: string;
  lat: number;
  lon: number;
  name: string | null;
  normalizedName: string;
  address: string | null;
  openingHours: string | null;
  shopTag: string | null;
  amenityTag: string | null;
  tags: Record<string, string>;
};

/** Normalise a name for comparison: strip diacritics, keep alnum, uppercase. */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const buildOsmAddress = (tags: Record<string, string>): string | null => {
  const street = tags['addr:street'];
  const num = tags['addr:housenumber'];
  const joined = [street, num].filter(Boolean).join(' ').trim();
  return joined || null;
};

/**
 * Parse a raw Overpass response into geolocated places. Elements without a
 * usable coordinate or without any of our target tags are dropped.
 */
export function parseOverpass(res: OverpassResponse): OsmPlace[] {
  const out: OsmPlace[] = [];
  for (const el of res.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const tags = el.tags ?? {};
    const shopTag = tags.shop ?? null;
    const amenityTag = tags.amenity ?? null;
    if (!shopTag && !amenityTag) continue;
    const name = tags.name ?? null;
    out.push({
      osmId: el.id,
      osmType: el.type,
      lat,
      lon,
      name,
      normalizedName: normalizeName(name),
      address: buildOsmAddress(tags),
      openingHours: tags.opening_hours ?? null,
      shopTag,
      amenityTag,
      tags,
    });
  }
  return out;
}

/**
 * Token-set similarity (Sørensen–Dice over unique word tokens), in [0,1].
 * A pragmatic reading of ADR-005's "normalised token-set ratio". Both inputs
 * are expected already normalised (see normalizeName).
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a && !b) return 0;
  if (a === b) return a ? 1 : 0;
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return (2 * inter) / (sa.size + sb.size);
}

/** Name similarity at/above this counts as a name match ('both'). ADR-005. */
export const NAME_MATCH_THRESHOLD = 0.6;

/** A `stores` row already known to be within the spatial radius of an OSM place. */
export type StoreCandidate = {
  storeId: number;
  normalizedName: string;
  distanceM: number;
};

export type MatchResult = {
  storeId: number;
  matchedBy: 'name' | 'spatial' | 'both';
  distanceM: number;
  score: number;
};

/**
 * Pick the best `stores` match for an OSM place from its already
 * spatially-filtered candidates (all within the radius). Best name similarity
 * wins; ties break on distance. Every result is at least a spatial match;
 * it becomes 'both' when the name similarity clears NAME_MATCH_THRESHOLD.
 * Returns null when there are no candidates.
 */
export function selectMatch(place: OsmPlace, candidates: StoreCandidate[]): MatchResult | null {
  if (candidates.length === 0) return null;
  let best: StoreCandidate | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const score = nameSimilarity(place.normalizedName, c.normalizedName);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && c.distanceM < best.distanceM)
    ) {
      best = c;
      bestScore = score;
    }
  }
  if (!best) return null;
  const nameMatched = place.normalizedName !== '' && bestScore >= NAME_MATCH_THRESHOLD;
  return {
    storeId: best.storeId,
    matchedBy: nameMatched ? 'both' : 'spatial',
    distanceM: best.distanceM,
    score: bestScore,
  };
}

// --- classification (OSM tags -> our model) --------------------------------

/** place_type values, mirrored from the shared PlaceType enum. */
export type OsmPlaceType =
  | 'bar'
  | 'supermercado'
  | 'alimentacion'
  | 'bodega'
  | 'tienda_24h'
  | 'otro';

export type OsmClassification = {
  placeType: OsmPlaceType;
  sellsOnsiteBeer: boolean;
  sellsTakeawayBeer: boolean;
};

const BAR_AMENITIES: ReadonlySet<string> = new Set([
  'bar',
  'pub',
  'cafe',
  'restaurant',
  'fast_food',
]);

const is24_7 = (hours: string | null): boolean => !!hours && /24\/7/.test(hours);

/**
 * Classify an OSM place into a canonical store (ADR-007). Bars/cafés/
 * restaurants consume on-site (barra); shops are takeaway (lata). Conservative:
 * anything we don't recognise is 'otro' with no beer flags.
 */
export function classifyOsmPlace(place: OsmPlace): OsmClassification {
  if (place.amenityTag && BAR_AMENITIES.has(place.amenityTag)) {
    return { placeType: 'bar', sellsOnsiteBeer: true, sellsTakeawayBeer: false };
  }
  switch (place.shopTag) {
    case 'supermarket':
      return { placeType: 'supermercado', sellsOnsiteBeer: false, sellsTakeawayBeer: true };
    case 'alcohol':
      return { placeType: 'bodega', sellsOnsiteBeer: false, sellsTakeawayBeer: true };
    case 'convenience':
      return {
        placeType: is24_7(place.openingHours) ? 'tienda_24h' : 'alimentacion',
        sellsOnsiteBeer: false,
        sellsTakeawayBeer: true,
      };
    case 'general':
    case 'kiosk':
      return { placeType: 'alimentacion', sellsOnsiteBeer: false, sellsTakeawayBeer: true };
    default:
      return { placeType: 'otro', sellsOnsiteBeer: false, sellsTakeawayBeer: false };
  }
}
