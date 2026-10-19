import { describe, expect, it } from 'vitest';
import {
  ORDINANCE,
  type PlaceForOpenNow,
  canSellBeerNow,
  isAlcoholTakeawayProhibited,
  isOpenNow,
  madridMinuteOfDay,
} from '../src/openNow.js';

/**
 * Construct a moment in time interpreted as Europe/Madrid HH:MM on 2026-06-03.
 * Madrid is UTC+2 in June (CEST). 13:30 local = 11:30 UTC.
 */
const madridAt = (hh: number, mm: number): Date => {
  const h = String(hh).padStart(2, '0');
  const m = String(mm).padStart(2, '0');
  return new Date(`2026-06-03T${h}:${m}:00+02:00`);
};

const wintertimeAt = (hh: number, mm: number): Date => {
  // Winter: Madrid is UTC+1. Use a January date.
  const h = String(hh).padStart(2, '0');
  const m = String(mm).padStart(2, '0');
  return new Date(`2026-01-15T${h}:${m}:00+01:00`);
};

const baseBar: PlaceForOpenNow = {
  place_type: 'bar',
  sells_takeaway_beer: false,
  opening_hours_osm: 'Mo-Su 09:00-02:00',
};

const baseShop: PlaceForOpenNow = {
  lat: 40.4168,
  lng: -3.7038,
  place_type: 'alimentacion',
  sells_takeaway_beer: true,
  opening_hours_osm: 'Mo-Sa 09:00-22:00',
};

const baseShop24h: PlaceForOpenNow = {
  lat: 40.4168,
  lng: -3.7038,
  place_type: 'tienda_24h',
  sells_takeaway_beer: true,
  opening_hours_osm: '24/7',
};

// ----------------------------------------------------------------------------

describe('madridMinuteOfDay', () => {
  it('summer 13:30 → 13*60+30', () => {
    expect(madridMinuteOfDay(madridAt(13, 30))).toBe(810);
  });
  it('winter 13:30 → same minute-of-day (TZ handled correctly)', () => {
    expect(madridMinuteOfDay(wintertimeAt(13, 30))).toBe(810);
  });
  it('midnight is 0', () => {
    expect(madridMinuteOfDay(madridAt(0, 0))).toBe(0);
  });
});

describe('isAlcoholTakeawayProhibited — Madrid ordinance window', () => {
  it('13:00 → allowed', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(13, 0))).toBe(false);
  });
  it('21:59 → still allowed (last minute)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(21, 59))).toBe(false);
  });
  it('22:00 → prohibited (boundary)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(22, 0))).toBe(true);
  });
  it('22:01 → prohibited', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(22, 1))).toBe(true);
  });
  it('02:00 (after midnight) → prohibited', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(2, 0))).toBe(true);
  });
  it('07:59 → prohibited (last minute of window)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(7, 59))).toBe(true);
  });
  it('08:00 → allowed (boundary)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(8, 0))).toBe(false);
  });
  it('window label matches constant', () => {
    expect(ORDINANCE.label).toBe('22:00–08:00');
  });
});

describe('isOpenNow', () => {
  it('null hours → not open, no closes_at', () => {
    expect(isOpenNow(null, madridAt(13, 0))).toEqual({
      open: false,
      closes_at: null,
    });
  });
  it('empty string → not open', () => {
    expect(isOpenNow('   ', madridAt(13, 0)).open).toBe(false);
  });
  it('malformed OSM string → not open, no throw', () => {
    expect(isOpenNow('garbage', madridAt(13, 0)).open).toBe(false);
  });
  it('Mo-Su 09:00-22:00 at 13:00 → open, closes_at 22:00', () => {
    const r = isOpenNow('Mo-Su 09:00-22:00', madridAt(13, 0));
    expect(r.open).toBe(true);
    expect(r.closes_at).toBe('22:00');
  });
  it('Mo-Su 09:00-22:00 at 23:00 → closed', () => {
    expect(isOpenNow('Mo-Su 09:00-22:00', madridAt(23, 0)).open).toBe(false);
  });
  it('24/7 anytime → open, closes_at null', () => {
    const r = isOpenNow('24/7', madridAt(4, 30));
    expect(r.open).toBe(true);
    expect(r.closes_at).toBeNull();
  });
  it('Mo-Su 09:00-02:00 (after midnight) at 23:30 → open, closes_at 02:00', () => {
    const r = isOpenNow('Mo-Su 09:00-02:00', madridAt(23, 30));
    expect(r.open).toBe(true);
    expect(r.closes_at).toBe('02:00');
  });
  it('a PH-prefixed 24h string (typical of fuel stations) evaluates open', () => {
    // "PH,..." throws without a country context — must not be swallowed as closed.
    expect(isOpenNow('PH,Mo-Su 00:00-24:00', madridAt(4, 30)).open).toBe(true);
    expect(isOpenNow('PH,Mo-Su 00:00-24:00', madridAt(23, 0)).open).toBe(true);
  });
});

describe('canSellBeerNow — unknown hours never imply open', () => {
  it('invalid published hours mean unknown, not confirmed closed', () => {
    const r = canSellBeerNow({ ...baseBar, opening_hours_osm: 'garbage' }, madridAt(13, 0));
    expect(r.hours_source).toBe('none');
    expect(r.reason).toBe('Horario no confirmado.');
  });

  it('uses website hours if OSM hours cannot be evaluated', () => {
    const r = canSellBeerNow(
      {
        ...baseBar,
        opening_hours_osm: 'garbage',
        opening_hours_web: '24/7',
        hours_web_observed_at: madridAt(12, 0),
      },
      madridAt(13, 0),
    );
    expect(r.hours_source).toBe('website');
    expect(r.sells_beer_now).toBe(true);
  });

  it('an explicit unknown state is not a closed place', () => {
    const r = canSellBeerNow({ ...baseBar, opening_hours_osm: 'Mo-Su unknown' }, madridAt(13, 0));
    expect(r.hours_source).toBe('none');
  });
  it('Tower Paradise: bar without hours at 13:00 is unknown, not recommended', () => {
    const r = canSellBeerNow({ ...baseBar, opening_hours_osm: null }, madridAt(13, 0));
    expect(r.open).toBe(false);
    expect(r.status).toBe('unknown');
    expect(r.sells_beer_now).toBe(false);
    expect(r.hours_source).toBe('none');
    expect(r.reason).toContain('Horario no confirmado');
  });

  it("'otro' without hours → no estimate, horario no confirmado", () => {
    const r = canSellBeerNow(
      { place_type: 'otro', sells_takeaway_beer: false, opening_hours_osm: null },
      madridAt(13, 0),
    );
    expect(r.open).toBe(false);
    expect(r.hours_source).toBe('none');
    expect(r.reason).toContain('Horario no confirmado');
  });

  it('real hours report hours_source=osm', () => {
    const r = canSellBeerNow(baseBar, madridAt(13, 0));
    expect(r.hours_source).toBe('osm');
  });
});

// 2026-06-03 (madridAt) is a Wednesday. Weekend cases pin explicit dates.
const madridOn = (isoDay: string, hh: number, mm: number): Date =>
  new Date(`${isoDay}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+02:00`);

describe('canSellBeerNow — no invented schedules at any time', () => {
  const barNoHours: PlaceForOpenNow = { ...baseBar, opening_hours_osm: null };

  it('bar, Wednesday 00:30 without hours remains unknown', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-03', 0, 30));
    expect(r.sells_beer_now).toBe(false);
    expect(r.hours_source).toBe('none');
  });

  it('bar, Wednesday 02:30 is not labelled closed without hours', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-03', 2, 30));
    expect(r.open).toBe(false);
    expect(r.status).toBe('unknown');
  });

  it('bar, Saturday 01:30 without hours cannot be recommended', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-06', 1, 30));
    expect(r.sells_beer_now).toBe(false);
  });

  it('supermarket, Sunday 16:00 without hours remains unknown', () => {
    const r = canSellBeerNow(
      { place_type: 'supermercado', sells_takeaway_beer: true, opening_hours_osm: null },
      madridOn('2026-06-07', 16, 0),
    );
    expect(r.open).toBe(false);
    expect(r.hours_source).toBe('none');
  });

  it('food shop, 21:00 without hours cannot be recommended', () => {
    const r = canSellBeerNow(
      { place_type: 'alimentacion', sells_takeaway_beer: true, opening_hours_osm: null },
      madridAt(21, 0),
    );
    expect(r.sells_beer_now).toBe(false);
    expect(r.status).toBe('unknown');
  });

  it('24h category alone is not an actual 24/7 schedule', () => {
    const r = canSellBeerNow({ ...baseShop24h, opening_hours_osm: null }, madridAt(4, 0));
    expect(r.open).toBe(false);
    expect(r.sells_beer_now).toBe(false);
    expect(r.status).toBe('unknown');
    expect(r.hours_source).toBe('none');
  });
});

describe('canSellBeerNow — bars are never subject to the ordinance', () => {
  it('bar at 13:00 → sells_beer_now=true', () => {
    const r = canSellBeerNow(baseBar, madridAt(13, 0));
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(true);
    expect(r.reason).toContain('según su horario');
  });
  it('bar at 23:30 (within hours) → sells_beer_now=true (ordinance does NOT apply)', () => {
    const r = canSellBeerNow(baseBar, madridAt(23, 30));
    expect(r.sells_beer_now).toBe(true);
  });
  it('bar at 04:00 with 24/7 hours → sells_beer_now=true', () => {
    const r = canSellBeerNow({ ...baseBar, opening_hours_osm: '24/7' }, madridAt(4, 0));
    expect(r.sells_beer_now).toBe(true);
  });
  it('bar after closing hour → cerrado', () => {
    const r = canSellBeerNow(baseBar, madridAt(3, 0));
    expect(r.open).toBe(false);
    expect(r.sells_beer_now).toBe(false);
    expect(r.reason).toBe('Cerrado según su horario.');
  });
});

describe('canSellBeerNow — shops and the ordinance', () => {
  it('shop with takeaway-beer at 13:00 → sells_beer_now=true', () => {
    const r = canSellBeerNow(baseShop, madridAt(13, 0));
    expect(r.sells_beer_now).toBe(true);
    expect(r.closes_at).toBe('22:00');
    expect(r.reason).toContain('cerveza para llevar');
  });
  it('shop with takeaway-beer at 21:59 → still allowed', () => {
    const r = canSellBeerNow(baseShop, madridAt(21, 59));
    expect(r.sells_beer_now).toBe(true);
  });
  it('shop with takeaway-beer at 22:00 → CLOSED by hours (Mo-Sa 09-22) before ordinance even applies', () => {
    const r = canSellBeerNow(baseShop, madridAt(22, 0));
    // The shop closes at exactly 22:00 per its hours, so it's already closed.
    expect(r.open).toBe(false);
    expect(r.reason).toBe('Cerrado según su horario.');
  });
  it('shop OPEN past 22:00 still gets ordinance reason', () => {
    const r = canSellBeerNow(
      { ...baseShop, opening_hours_osm: 'Mo-Su 09:00-23:00' },
      madridAt(22, 30),
    );
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(false);
    expect(r.reason).toContain('Ordenanza municipal');
  });
  it('shop without sells_takeaway_beer at 13:00 → sells_beer_now=false, reason no vende', () => {
    const r = canSellBeerNow({ ...baseShop, sells_takeaway_beer: false }, madridAt(13, 0));
    expect(r.sells_beer_now).toBe(false);
    expect(r.reason).toContain('No consta venta');
  });
});

describe('canSellBeerNow — 24h shops and the ordinance', () => {
  it('24/7 shop at 04:00 → open=true, sells_beer_now=false (ordinance)', () => {
    const r = canSellBeerNow(baseShop24h, madridAt(4, 0));
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(false);
    expect(r.reason).toContain('Ordenanza municipal');
  });
  it('24/7 shop at 13:00 → sells_beer_now=true', () => {
    const r = canSellBeerNow(baseShop24h, madridAt(13, 0));
    expect(r.sells_beer_now).toBe(true);
    expect(r.closes_at).toBeNull();
  });
  it('24/7 shop at 22:00 sharp → ordinance kicks in', () => {
    const r = canSellBeerNow(baseShop24h, madridAt(22, 0));
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(false);
  });
  it('24/7 shop at 08:00 sharp → general restriction lifts', () => {
    const r = canSellBeerNow(baseShop24h, madridAt(8, 0));
    expect(r.sells_beer_now).toBe(true);
  });
});

describe('national time and policy regressions', () => {
  const canary = { lat: 28.467, lng: -16.25 };

  it('does not apply Madrid sale restrictions to Barcelona or Canarias', () => {
    for (const coordinates of [canary, { lat: 41.387, lng: 2.17 }]) {
      const result = canSellBeerNow({ ...baseShop24h, ...coordinates }, madridAt(23, 0));
      expect(result.open).toBe(true);
      expect(result.sells_beer_now).toBe(true);
      expect(result.sale_policy).toBe('unknown');
      expect(result.reason).toContain('normativa local no evaluada');
    }
  });

  it('evaluates the same instant in each place timezone, not the server timezone', () => {
    const now = new Date('2026-06-03T20:30:00Z'); // Madrid 22:30, Canarias 21:30
    const hours = 'Mo-Su 09:00-22:00';
    expect(isOpenNow(hours, now, baseShop).open).toBe(false);
    expect(isOpenNow(hours, now, canary)).toEqual({ open: true, closes_at: '22:00' });
  });

  it('uses the Canary calendar date around midnight and during winter', () => {
    expect(isOpenNow('Mo 20:00-24:00', new Date('2026-10-19T22:30:00Z'), canary).open).toBe(true);
    expect(isOpenNow('Mo 20:00-24:00', new Date('2026-10-19T22:30:00Z'), baseShop).open).toBe(
      false,
    );
    expect(isOpenNow('Mo-Su 09:00-22:00', new Date('2026-01-15T21:30:00Z'), canary).open).toBe(
      true,
    );
  });

  it('handles both occurrences of a repeated local hour when daylight saving ends', () => {
    for (const instant of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
      expect(isOpenNow('Su 02:00-03:00', new Date(instant), baseShop).open).toBe(true);
    }
  });

  it('does not infer a Madrid policy when the place coordinates are missing', () => {
    const result = canSellBeerNow(
      { ...baseShop24h, lat: undefined, lng: undefined },
      madridAt(23, 0),
    );
    expect(result.sale_policy).toBe('unknown');
  });
});

describe('canSellBeerNow — supermercado at the witching hour', () => {
  it('Mercadona open 09:00-21:30 at 21:25 → sells_beer_now=true, cierra pronto', () => {
    const r = canSellBeerNow(
      {
        place_type: 'supermercado',
        sells_takeaway_beer: true,
        opening_hours_osm: 'Mo-Sa 09:00-21:30; Su 09:00-15:00',
      },
      madridAt(21, 25),
    );
    expect(r.sells_beer_now).toBe(true);
    expect(r.closes_at).toBe('21:30');
  });
});
