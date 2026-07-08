import { afterEach, describe, expect, it } from 'vitest';
import {
  type OverpassResponse,
  type StoreCandidate,
  buildOverpassQuery,
  getOverpassConfig,
  nameSimilarity,
  normalizeName,
  parseOverpass,
  selectMatch,
} from '../src/sources/osm.js';

describe('normalizeName', () => {
  it('strips diacritics, punctuation and casing', () => {
    expect(normalizeName('Bar José, S.L.')).toBe('BAR JOSE S L');
    expect(normalizeName('  Cervecería  El   Águila ')).toBe('CERVECERIA EL AGUILA');
  });

  it('is empty for null/blank', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName('  ')).toBe('');
  });
});

describe('nameSimilarity', () => {
  it('is 1 for identical non-empty names', () => {
    expect(nameSimilarity('BAR PEPE', 'BAR PEPE')).toBe(1);
  });

  it('is 0 when either side is empty', () => {
    expect(nameSimilarity('', 'BAR PEPE')).toBe(0);
    expect(nameSimilarity('BAR PEPE', '')).toBe(0);
    expect(nameSimilarity('', '')).toBe(0);
  });

  it('rewards shared tokens (Dice over token sets)', () => {
    // {BAR,PEPE} vs {BAR,PEPE,SL}: 2*2/(2+3) = 0.8
    expect(nameSimilarity('BAR PEPE', 'BAR PEPE SL')).toBeCloseTo(0.8, 5);
  });

  it('is 0 for disjoint token sets', () => {
    expect(nameSimilarity('BAR PEPE', 'SUPER SOL')).toBe(0);
  });
});

describe('parseOverpass', () => {
  const res: OverpassResponse = {
    elements: [
      // node with hours
      {
        type: 'node',
        id: 1,
        lat: 40.4,
        lon: -3.7,
        tags: { amenity: 'bar', name: 'Bar Uno', opening_hours: 'Mo-Su 09:00-24:00' },
      },
      // way with center, shop, address
      {
        type: 'way',
        id: 2,
        center: { lat: 40.41, lon: -3.71 },
        tags: {
          shop: 'supermarket',
          name: 'Súper Dos',
          'addr:street': 'Calle Mayor',
          'addr:housenumber': '3',
        },
      },
      // no coordinate -> dropped
      { type: 'node', id: 3, tags: { amenity: 'pub', name: 'Sin Coord' } },
      // no target tag -> dropped
      { type: 'node', id: 4, lat: 40.4, lon: -3.7, tags: { name: 'Nada' } },
    ],
  };

  it('keeps only geolocated, tagged elements', () => {
    const places = parseOverpass(res);
    expect(places.map((p) => p.osmId).sort()).toEqual([1, 2]);
  });

  it('extracts hours, normalized name and address', () => {
    const [bar, market] = parseOverpass(res);
    expect(bar.openingHours).toBe('Mo-Su 09:00-24:00');
    expect(bar.amenityTag).toBe('bar');
    expect(bar.normalizedName).toBe('BAR UNO');
    expect(market.address).toBe('Calle Mayor 3');
    expect(market.shopTag).toBe('supermarket');
    expect(market.openingHours).toBeNull();
  });
});

describe('selectMatch', () => {
  const place = parseOverpass({
    elements: [
      { type: 'node', id: 9, lat: 40.4, lon: -3.7, tags: { amenity: 'bar', name: 'Bar Pepe' } },
    ],
  })[0];

  it('returns null with no candidates', () => {
    expect(selectMatch(place, [])).toBeNull();
  });

  it('marks a strong name overlap as "both"', () => {
    const cands: StoreCandidate[] = [
      { storeId: 1, normalizedName: 'BAR PEPE', distanceM: 12 },
      { storeId: 2, normalizedName: 'OTRA COSA', distanceM: 4 },
    ];
    const m = selectMatch(place, cands);
    expect(m?.storeId).toBe(1);
    expect(m?.matchedBy).toBe('both');
    expect(m?.score).toBe(1);
  });

  it('falls back to "spatial" when names do not clear the threshold', () => {
    const cands: StoreCandidate[] = [
      { storeId: 5, normalizedName: 'FARMACIA CENTRAL', distanceM: 8 },
    ];
    const m = selectMatch(place, cands);
    expect(m?.storeId).toBe(5);
    expect(m?.matchedBy).toBe('spatial');
  });
});

describe('getOverpassConfig + buildOverpassQuery', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('parses bbox and builds a query for both amenity and shop', () => {
    process.env.OSM_OVERPASS_URL = 'https://overpass.example/api';
    process.env.OSM_BBOX = '40.31,-3.84,40.52,-3.55';
    process.env.OSM_OVERPASS_TIMEOUT = '90';
    const cfg = getOverpassConfig();
    expect(cfg.bbox).toEqual([40.31, -3.84, 40.52, -3.55]);
    expect(cfg.timeoutSec).toBe(90);
    const q = buildOverpassQuery(cfg);
    expect(q).toContain('[timeout:90]');
    expect(q).toContain('nwr["amenity"~"^(bar|pub|cafe|restaurant|fast_food)$"]');
    expect(q).toContain('nwr["shop"~"^(convenience|alcohol|supermarket|general|kiosk)$"]');
    expect(q).toContain('40.31,-3.84,40.52,-3.55');
    expect(q).toContain('out center tags;');
  });

  it('rejects a malformed bbox', () => {
    process.env.OSM_OVERPASS_URL = 'https://overpass.example/api';
    process.env.OSM_BBOX = '40.31,-3.84,40.52';
    expect(() => getOverpassConfig()).toThrow(/OSM_BBOX/);
  });

  it('rejects an inverted bbox', () => {
    process.env.OSM_OVERPASS_URL = 'https://overpass.example/api';
    process.env.OSM_BBOX = '40.52,-3.55,40.31,-3.84';
    expect(() => getOverpassConfig()).toThrow(/valid box/);
  });
});
