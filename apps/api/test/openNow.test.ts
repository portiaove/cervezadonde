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
  place_type: 'alimentacion',
  sells_takeaway_beer: true,
  opening_hours_osm: 'Mo-Sa 09:00-22:00',
};

const baseShop24h: PlaceForOpenNow = {
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
  it('08:59 → prohibited (last minute of window)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(8, 59))).toBe(true);
  });
  it('09:00 → allowed (boundary)', () => {
    expect(isAlcoholTakeawayProhibited(madridAt(9, 0))).toBe(false);
  });
  it('window label matches constant', () => {
    expect(ORDINANCE.label).toBe('22:00–09:00');
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
});

describe('canSellBeerNow — null hours fall back to the default schedule', () => {
  it('bar without hours at 13:00 → estimated open ("suele estar abierto")', () => {
    const r = canSellBeerNow({ ...baseBar, opening_hours_osm: null }, madridAt(13, 0));
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(true);
    expect(r.hours_source).toBe('estimated');
    expect(r.reason).toContain('Suele estar abierto');
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

describe('canSellBeerNow — default schedules (estimated)', () => {
  const barNoHours: PlaceForOpenNow = { ...baseBar, opening_hours_osm: null };

  it('bar, Wednesday 00:30 → still open (Mo-Th until 01:00)', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-03', 0, 30));
    expect(r.sells_beer_now).toBe(true);
    expect(r.hours_source).toBe('estimated');
  });

  it('bar, Wednesday 02:30 → estimated closed', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-03', 2, 30));
    expect(r.open).toBe(false);
    expect(r.reason).toContain('Suele estar cerrado');
  });

  it('bar, Saturday 01:30 (Friday night) → open (Fr-Sa until 02:00)', () => {
    const r = canSellBeerNow(barNoHours, madridOn('2026-06-06', 1, 30));
    expect(r.sells_beer_now).toBe(true);
  });

  it('supermercado, Sunday 16:00 → estimated closed (Su 10:00-15:00)', () => {
    const r = canSellBeerNow(
      { place_type: 'supermercado', sells_takeaway_beer: true, opening_hours_osm: null },
      madridOn('2026-06-07', 16, 0),
    );
    expect(r.open).toBe(false);
    expect(r.hours_source).toBe('estimated');
  });

  it('alimentación, 21:00 → estimated open and allowed to sell', () => {
    const r = canSellBeerNow(
      { place_type: 'alimentacion', sells_takeaway_beer: true, opening_hours_osm: null },
      madridAt(21, 0),
    );
    expect(r.sells_beer_now).toBe(true);
    expect(r.reason).toContain('Suele estar abierto');
  });

  it('tienda 24h, 04:00 → estimated open but ordinance blocks the sale', () => {
    const r = canSellBeerNow(
      { place_type: 'tienda_24h', sells_takeaway_beer: true, opening_hours_osm: null },
      madridAt(4, 0),
    );
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(false);
    expect(r.reason).toContain('Ordenanza');
    expect(r.hours_source).toBe('estimated');
  });
});

describe('canSellBeerNow — bars are never subject to the ordinance', () => {
  it('bar at 13:00 → sells_beer_now=true', () => {
    const r = canSellBeerNow(baseBar, madridAt(13, 0));
    expect(r.open).toBe(true);
    expect(r.sells_beer_now).toBe(true);
    expect(r.reason).toContain('Bar abierto');
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
    expect(r.reason).toBe('Cerrado.');
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
    expect(r.reason).toBe('Cerrado.');
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
    expect(r.reason).toContain('No vende alcohol');
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
  it('24/7 shop at 09:00 sharp → ordinance lifts', () => {
    const r = canSellBeerNow(baseShop24h, madridAt(9, 0));
    expect(r.sells_beer_now).toBe(true);
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
