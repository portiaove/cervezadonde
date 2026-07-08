// Open-now evaluator and Madrid alcohol-sale ordinance check.
// See docs/04-domain-model.md (canSellBeerNow) and decisions/ADR-004.
//
// Pure functions. Europe/Madrid timezone. No DB access.
// The ordinance window (22:00 → 09:00) and the local time arithmetic are
// the *only* place these rules live in the codebase.

import OpeningHours from 'opening_hours';

export const MADRID_TZ = 'Europe/Madrid';

/** Window during which takeaway alcohol sales are prohibited (Madrid ordinance). */
export const ORDINANCE = {
  startHour: 22,
  endHour: 9,
  label: '22:00–09:00',
} as const;

export type PlaceForOpenNow = {
  place_type:
    | 'bar'
    | 'supermercado'
    | 'alimentacion'
    | 'bodega'
    | 'tienda_24h'
    | 'otro';
  sells_takeaway_beer: boolean;
  opening_hours_osm: string | null;
};

export type IsOpenResult = {
  open: boolean;
  closes_at: string | null;
};

export type CanSellBeerResult = {
  open: boolean;
  closes_at: string | null;
  sells_beer_now: boolean;
  reason: string;
};

// --- timezone helpers ------------------------------------------------------

const MADRID_HHMM_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Minute-of-day (0–1439) for `now` interpreted in Europe/Madrid. */
export function madridMinuteOfDay(now: Date): number {
  const parts = MADRID_HHMM_FMT.formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** HH:MM string for `d` interpreted in Europe/Madrid. */
export function formatMadridHHMM(d: Date): string {
  return MADRID_HHMM_FMT.format(d);
}

// --- ordinance -------------------------------------------------------------

/**
 * Madrid municipal ordinance: takeaway alcohol sales are prohibited from
 * 22:00 to 09:00 local time. Window crosses midnight.
 */
export function isAlcoholTakeawayProhibited(now: Date): boolean {
  const minutes = madridMinuteOfDay(now);
  return minutes >= ORDINANCE.startHour * 60 || minutes < ORDINANCE.endHour * 60;
}

// --- opening hours ---------------------------------------------------------

/**
 * Evaluate whether the place is open at `now`, given an OSM `opening_hours`
 * string. Returns `closes_at` as a Europe/Madrid HH:MM when the next change
 * is a close, otherwise null (e.g. 24/7 places).
 *
 * Defensive: invalid strings or null hours → `{ open: false, closes_at: null }`.
 */
export function isOpenNow(
  openingHoursOsm: string | null,
  now: Date,
): IsOpenResult {
  if (!openingHoursOsm || openingHoursOsm.trim() === '') {
    return { open: false, closes_at: null };
  }
  try {
    const oh = new OpeningHours(openingHoursOsm, undefined, {
      tag_key: 'opening_hours',
      locale: 'es',
    } as never);
    const open = oh.getState(now);
    if (!open) return { open: false, closes_at: null };
    const nextChange = oh.getNextChange(now) as Date | undefined;
    const closes_at = nextChange ? formatMadridHHMM(nextChange) : null;
    return { open: true, closes_at };
  } catch {
    return { open: false, closes_at: null };
  }
}

// --- combined verdict ------------------------------------------------------

/**
 * Beer-availability verdict for a place at `now`. Encodes:
 * - Unknown hours → "horario no confirmado".
 * - Closed → "Cerrado".
 * - Bar serving on-site → not subject to the takeaway ordinance.
 * - Shop with takeaway-beer flag → subject to the ordinance.
 * - Shop without takeaway-beer flag → never sells beer.
 */
export function canSellBeerNow(
  place: PlaceForOpenNow,
  now: Date,
): CanSellBeerResult {
  // Unknown hours — be conservative. We don't claim "open" without evidence.
  if (!place.opening_hours_osm || place.opening_hours_osm.trim() === '') {
    return {
      open: false,
      closes_at: null,
      sells_beer_now: false,
      reason: 'Horario no confirmado.',
    };
  }

  const { open, closes_at } = isOpenNow(place.opening_hours_osm, now);
  if (!open) {
    return {
      open: false,
      closes_at: null,
      sells_beer_now: false,
      reason: 'Cerrado.',
    };
  }

  // Bars consume on-site — ordinance doesn't apply.
  if (place.place_type === 'bar') {
    return {
      open: true,
      closes_at,
      sells_beer_now: true,
      reason: 'Bar abierto en horario habitual.',
    };
  }

  // Non-bars: must have the takeaway-beer flag.
  if (!place.sells_takeaway_beer) {
    return {
      open: true,
      closes_at,
      sells_beer_now: false,
      reason: 'No vende alcohol para llevar.',
    };
  }

  // Madrid ordinance applies to non-bars.
  if (isAlcoholTakeawayProhibited(now)) {
    return {
      open: true,
      closes_at,
      sells_beer_now: false,
      reason: `Ordenanza municipal: no puede vender alcohol para llevar de ${ORDINANCE.label}.`,
    };
  }

  return {
    open: true,
    closes_at,
    sells_beer_now: true,
    reason: 'Abierto. Puede venderte cerveza para llevar.',
  };
}
