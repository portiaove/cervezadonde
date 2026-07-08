import { describe, expect, it } from 'vitest';
import { SCORING_VERSION, normalize, scoreCandidate } from '../../src/scoring/v2.js';

const CHAINS = [
  'MERCADONA',
  'CARREFOUR',
  'DIA',
  'LIDL',
  'ALDI',
  'EL CORTE INGLES',
];

const baseInput = (overrides: Partial<Parameters<typeof scoreCandidate>[0]> = {}) =>
  scoreCandidate({
    name: '',
    epigraphCodes: [],
    officialStatus: 'Abierto',
    openingHoursOsm: null,
    chainPatterns: CHAINS,
    ...overrides,
  });

describe('normalize', () => {
  it('uppercases and strips diacritics', () => {
    expect(normalize('Cafetería del Río')).toBe('CAFETERIA DEL RIO');
  });
  it('handles null defensively', () => {
    expect(normalize(null)).toBe('');
  });
});

describe('placeType from epigraph', () => {
  it('561001 → bar', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'] });
    expect(r.placeType).toBe('bar');
    expect(r.sellsOnsiteBeer).toBe(true);
    expect(r.sellsTakeawayBeer).toBe(false);
  });
  it('561005 cafetería → bar', () => {
    const r = baseInput({ name: 'CAFETERIA LOS ARCOS', epigraphCodes: ['561005'] });
    expect(r.placeType).toBe('bar');
  });
  it('471103 conveniencia 24h → tienda_24h', () => {
    const r = baseInput({ name: 'MINI MARKET', epigraphCodes: ['471103'] });
    expect(r.placeType).toBe('tienda_24h');
    expect(r.sellsTakeawayBeer).toBe(true);
  });
  it('472502 bodega → bodega', () => {
    const r = baseInput({ name: 'VINOS PEPE', epigraphCodes: ['472502'] });
    expect(r.placeType).toBe('bodega');
  });
  it('471101 alimentación → alimentacion', () => {
    const r = baseInput({ name: 'ALIMENTACION LA ESTRELLA', epigraphCodes: ['471101'] });
    expect(r.placeType).toBe('alimentacion');
  });
  it('no target epigraph + no signal → otro and excluded', () => {
    const r = baseInput({ name: 'ZAPATERIA EL TACON', epigraphCodes: ['477110'] });
    expect(r.placeType).toBe('otro');
    expect(r.level).toBe('excluded');
  });
});

describe('placeType from name when epigraph is ambiguous', () => {
  it('rotulo BODEGA without epigraph → bodega', () => {
    const r = baseInput({ name: 'BODEGA EL TINTO', epigraphCodes: [] });
    expect(r.placeType).toBe('bodega');
  });
  it('rotulo 24H → tienda_24h', () => {
    const r = baseInput({ name: 'TIENDA 24H', epigraphCodes: ['472501'] });
    expect(r.placeType).toBe('tienda_24h');
  });
  it('rotulo ULTRAMARINOS → alimentacion', () => {
    const r = baseInput({ name: 'ULTRAMARINOS CASTELLANA', epigraphCodes: [] });
    expect(r.placeType).toBe('alimentacion');
  });
});

describe('placeType priority: OSM > epigraph > chain > name', () => {
  it('OSM amenity=bar overrides shop epigraph', () => {
    const r = baseInput({
      name: 'ALIMENTACION X',
      epigraphCodes: ['471101'],
      osmTags: { amenity: 'bar' },
    });
    expect(r.placeType).toBe('bar');
  });
  it('OSM shop=alcohol overrides everything else', () => {
    const r = baseInput({
      name: 'TIENDA',
      epigraphCodes: ['471101'],
      osmTags: { shop: 'alcohol' },
    });
    expect(r.placeType).toBe('bodega');
  });
});

describe('chains are surfaced, not excluded', () => {
  it('MERCADONA → supermercado, is_chain, sells_takeaway, NOT excluded', () => {
    const r = baseInput({ name: 'MERCADONA', epigraphCodes: ['471101'] });
    expect(r.placeType).toBe('supermercado');
    expect(r.isChain).toBe(true);
    expect(r.sellsTakeawayBeer).toBe(true);
    expect(r.level).not.toBe('excluded');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
  it('CARREFOUR EXPRESS → supermercado', () => {
    const r = baseInput({ name: 'CARREFOUR EXPRESS', epigraphCodes: ['471101'] });
    expect(r.placeType).toBe('supermercado');
    expect(r.isChain).toBe(true);
  });
  it('DIA matches via word boundary; ALIMENTACION DIANA does NOT', () => {
    const dia = baseInput({ name: 'DIA MARKET', epigraphCodes: ['471101'] });
    expect(dia.isChain).toBe(true);
    expect(dia.placeType).toBe('supermercado');
    const diana = baseInput({ name: 'ALIMENTACION DIANA', epigraphCodes: ['471101'] });
    expect(diana.isChain).toBe(false);
    expect(diana.placeType).toBe('alimentacion');
  });
});

describe('officially closed → excluded', () => {
  it('Baja status', () => {
    const r = baseInput({ name: 'X', epigraphCodes: ['471101'], officialStatus: 'Baja' });
    expect(r.level).toBe('excluded');
    expect(r.score).toBe(0);
    expect(r.badges).toContain('posible_cerrado');
  });
  it('Uso vivienda', () => {
    const r = baseInput({
      name: 'X',
      epigraphCodes: ['471101'],
      officialStatus: 'Uso vivienda',
    });
    expect(r.level).toBe('excluded');
  });
  it('null status treated as open', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'], officialStatus: null });
    expect(r.level).toBe('high');
  });
});

describe('opening_hours bonus', () => {
  it('bar without hours: high but no hours bonus', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'] });
    expect(r.score).toBe(95); // 90 base + 5 name BAR hint
    expect(r.badges).toContain('horario_no_confirmado');
  });
  it('bar with hours: +15 bonus, clamped to 100', () => {
    const r = baseInput({
      name: 'BAR PEPE',
      epigraphCodes: ['561001'],
      openingHoursOsm: 'Mo-Su 09:00-23:00',
    });
    expect(r.score).toBe(100);
    expect(r.badges).not.toContain('horario_no_confirmado');
  });
  it('alimentación with hours moves from medium-ish to high', () => {
    const without = baseInput({ name: 'TIENDA X', epigraphCodes: ['471101'] });
    const withHours = baseInput({
      name: 'TIENDA X',
      epigraphCodes: ['471101'],
      openingHoursOsm: 'Mo-Sa 09:00-21:00',
    });
    expect(withHours.score).toBeGreaterThan(without.score);
    expect(withHours.level).toBe('high');
  });
  it('24/7 string applies extra +10 on top of the hours bonus', () => {
    const r = baseInput({
      name: 'TIENDA',
      epigraphCodes: ['471103'],
      openingHoursOsm: '24/7',
    });
    expect(r.score).toBe(100);
  });
});

describe('sells_takeaway / sells_onsite', () => {
  it('bar: onsite=true, takeaway=false', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'] });
    expect(r.sellsOnsiteBeer).toBe(true);
    expect(r.sellsTakeawayBeer).toBe(false);
  });
  it('supermercado: takeaway=true, onsite=false', () => {
    const r = baseInput({ name: 'MERCADONA', epigraphCodes: ['471101'] });
    expect(r.sellsTakeawayBeer).toBe(true);
    expect(r.sellsOnsiteBeer).toBe(false);
  });
  it('bodega: takeaway=true (sells bottles for home)', () => {
    const r = baseInput({ name: 'BODEGA EL TINTO', epigraphCodes: ['472502'] });
    expect(r.sellsTakeawayBeer).toBe(true);
  });
  it('OSM shop=alcohol implies takeaway', () => {
    const r = baseInput({
      name: 'X',
      epigraphCodes: [],
      osmTags: { shop: 'alcohol' },
    });
    expect(r.sellsTakeawayBeer).toBe(true);
  });
  it('OSM amenity=cafe implies onsite — unless rotulo screams "PANADERIA"', () => {
    const cafe = baseInput({
      name: 'CAFE DE LA UNION',
      epigraphCodes: [],
      osmTags: { amenity: 'cafe' },
    });
    expect(cafe.sellsOnsiteBeer).toBe(true);

    const bakery = baseInput({
      name: 'PANADERIA Y CAFE LOS HORNOS',
      epigraphCodes: [],
      osmTags: { amenity: 'cafe' },
    });
    expect(bakery.sellsOnsiteBeer).toBe(false);
  });
});

describe('badges', () => {
  it('place_type badge mirrors the column', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'] });
    expect(r.badges).toContain('bar');
  });
  it('otro does NOT add a place-type badge', () => {
    const r = baseInput({
      name: 'BAR PEPE',
      epigraphCodes: [],
      osmTags: { amenity: 'bar' },
    });
    expect(r.placeType).toBe('bar');
    // Sanity that otro pathway omits the badge:
    const otro = baseInput({ name: 'XYZ', epigraphCodes: ['477110'] });
    expect(otro.placeType).toBe('otro');
    expect(otro.badges).not.toContain('otro');
  });
  it('vende_cerveza_in_situ + para_llevar present on a bodega-bar', () => {
    const r = baseInput({
      name: 'BODEGA Y BAR EL TINTO',
      epigraphCodes: ['472502'],
      osmTags: { amenity: 'bar' },
    });
    expect(r.badges).toContain('vende_cerveza_in_situ');
    expect(r.badges).toContain('vende_cerveza_para_llevar');
  });
});

describe('score clamping and version', () => {
  it('clamps above 100', () => {
    const r = baseInput({
      name: 'BAR CERVECERIA ALIMENTACION 24H BODEGA',
      epigraphCodes: ['561001'],
      openingHoursOsm: '24/7',
      osmTags: { amenity: 'bar', shop: 'alcohol' },
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it('clamps at 0 for no-signal otro', () => {
    const r = baseInput({ name: 'ZAPATERIA', epigraphCodes: ['477110'] });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
  it('reports scoringVersion v2-beer', () => {
    const r = baseInput({ name: 'BAR PEPE', epigraphCodes: ['561001'] });
    expect(r.scoringVersion).toBe(SCORING_VERSION);
    expect(SCORING_VERSION).toBe('v2-beer');
  });
});
