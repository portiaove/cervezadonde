import { describe, expect, it } from 'vitest';
import {
  type CensoMatchCandidate,
  arePlaceTypesCompatible,
  evaluateCensoMatch,
  selectHighPrecisionCensoMatches,
} from '../src/censo-match.js';

const candidate = (overrides: Partial<CensoMatchCandidate> = {}): CensoMatchCandidate => ({
  osmId: 1,
  censoId: 10,
  censoSource: 'censo_madrid',
  censoLocalId: 'c-10',
  distanceM: 8,
  osmName: 'BAR PACO',
  censoName: 'BAR PACO',
  osmPlaceType: 'bar',
  censoPlaceType: 'bar',
  ...overrides,
});

describe('censo match evidence', () => {
  it('treats takeaway taxonomies as compatible but not bar vs shop', () => {
    expect(arePlaceTypesCompatible('supermercado', 'alimentacion')).toBe(true);
    expect(arePlaceTypesCompatible('bodega', 'tienda_24h')).toBe(true);
    expect(arePlaceTypesCompatible('bar', 'alimentacion')).toBe(false);
  });

  it('accepts a non-generic exact name across the full 30 m radius', () => {
    expect(evaluateCensoMatch(candidate({ distanceM: 29 }))?.method).toBe('exact_name');
  });

  it('rejects an exact name when the functional types are incompatible', () => {
    expect(evaluateCensoMatch(candidate({ censoPlaceType: 'alimentacion' }))).toBeNull();
  });

  it('rejects matching generic activity labels', () => {
    expect(evaluateCensoMatch(candidate({ osmName: 'BAR', censoName: 'BAR' }))).toBeNull();
    expect(
      evaluateCensoMatch(
        candidate({
          osmName: 'ALIMENTACION Y BAZAR',
          censoName: 'ALIMENTACION Y BAZAR',
          osmPlaceType: 'alimentacion',
          censoPlaceType: 'alimentacion',
        }),
      ),
    ).toBeNull();
  });

  it('accepts moderate name similarity only when type and distance support it', () => {
    const match = candidate({
      osmName: 'CASA MANOLO',
      censoName: 'BAR CASA MANOLO MADRID',
      distanceM: 7,
    });
    expect(evaluateCensoMatch(match)?.method).toBe('name_and_type');
    expect(evaluateCensoMatch({ ...match, censoPlaceType: 'alimentacion' })).toBeNull();
    expect(evaluateCensoMatch({ ...match, distanceM: 15 })).toBeNull();
  });

  it('never treats an unnamed point as independently corroborated', () => {
    expect(evaluateCensoMatch(candidate({ osmName: '', distanceM: 0.5 }))).toBeNull();
  });
});

describe('one-to-one selection', () => {
  it('rejects every candidate attached to an ambiguous censo row', () => {
    const matches = selectHighPrecisionCensoMatches([
      candidate({ osmId: 1, censoId: 10, distanceM: 8 }),
      candidate({
        osmId: 1,
        censoId: 11,
        distanceM: 2,
        censoName: 'BAR DISTINTO',
      }),
      candidate({ osmId: 2, censoId: 10, distanceM: 3 }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('rejects every candidate attached to an ambiguous OSM row', () => {
    const matches = selectHighPrecisionCensoMatches([
      candidate({ osmId: 1, censoId: 10, distanceM: 1 }),
      candidate({ osmId: 2, censoId: 10, distanceM: 2 }),
      candidate({ osmId: 2, censoId: 11, distanceM: 3 }),
    ]);

    expect(matches).toHaveLength(0);
  });

  it('keeps disjoint evidence-qualified pairs', () => {
    const matches = selectHighPrecisionCensoMatches([
      candidate({ osmId: 1, censoId: 10, distanceM: 1 }),
      candidate({ osmId: 2, censoId: 11, distanceM: 2 }),
    ]);

    expect(matches).toHaveLength(2);
  });
});
