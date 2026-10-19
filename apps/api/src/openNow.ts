// Open-now evaluator and Madrid alcohol-sale ordinance check.
// See docs/04-domain-model.md (canSellBeerNow) and decisions/ADR-004.
//
// Pure functions. Place-local time. No DB access.
// The Madrid general night window (22:00 → 08:00) and local time arithmetic are
// the *only* place these rules live in the codebase.
//
// opening_hours reads process-local Date fields. The API process runs in UTC;
// we supply a wall-clock date in the place's zone, including Canarias.

import OpeningHours from 'opening_hours';
import { type Coordinates, isMadridMunicipality, timeZoneForPlace } from './geography.js';

export const MADRID_TZ = 'Europe/Madrid';

/** Madrid general night window, subject to licence exceptions (Ley 5/2002 art. 30.4). */
export const ORDINANCE = {
  startHour: 22,
  endHour: 8,
  label: '22:00–08:00',
} as const;

export type PlaceForOpenNow = Coordinates & {
  place_type:
    | 'bar'
    | 'supermercado'
    | 'alimentacion'
    | 'bodega'
    | 'tienda_24h'
    | 'gasolinera'
    | 'otro';
  sells_takeaway_beer: boolean;
  sells_onsite_beer?: boolean;
  opening_hours_osm: string | null;
  /** Hours crawled from the business website (crawl:hours). Optional for callers without it. */
  opening_hours_web?: string | null;
  hours_web_observed_at?: Date | string | null;
  hours_disputed?: boolean;
  reviewed_hours?: string | null;
};

export type IsOpenResult = {
  open: boolean;
  closes_at: string | null;
};

export type HoursSource = 'osm' | 'website' | 'reviewed' | 'none';

export type CanSellBeerResult = {
  open: boolean;
  status: 'open' | 'closed' | 'unknown';
  closes_at: string | null;
  sells_beer_now: boolean;
  reason: string;
  hours_source: HoursSource;
  sale_policy: 'madrid_general' | 'not_applicable' | 'unknown';
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
 * General Madrid restriction: 22:00 to 08:00 local time, subject to licence
 * exceptions. Geographic dispatch is separate. Window crosses midnight.
 */
export function isAlcoholTakeawayProhibited(now: Date): boolean {
  const minutes = madridMinuteOfDay(now);
  return minutes >= ORDINANCE.startHour * 60 || minutes < ORDINANCE.endHour * 60;
}

// --- opening hours ---------------------------------------------------------

/**
 * Evaluate whether the place is open at `now`, given an OSM `opening_hours`
 * string. Returns `closes_at` as a place-local HH:MM when the next change
 * is a close, otherwise null (e.g. 24/7 places).
 *
 * Defensive: invalid strings or null hours → `{ open: false, closes_at: null }`.
 */
// Public/school-holiday selectors (PH/SH) make the opening_hours parser throw
// unless it's given a country context. Retrying with Spain lets common strings
// like "PH,Mo-Su 00:00-24:00" (typical of 24h fuel stations) evaluate instead
// of being swallowed as "closed". lat/lon = Madrid centroid (only affects the
// rare sunrise/sunset-based rules; PH resolves from the country code).
const ES_NOMINATIM = { address: { country_code: 'es' }, lat: 40.4168, lon: -3.7038 };

const WALL_CLOCK_FORMATTERS = new Map(
  ['Europe/Madrid', 'Atlantic/Canary'].map((timeZone) => [
    timeZone,
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
  ]),
);

function wallClockDate(now: Date, timeZone: string): Date {
  const parts = WALL_CLOCK_FORMATTERS.get(timeZone)?.formatToParts(now) ?? [];
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === name)?.value);
  return new Date(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}

export function isOpenNow(
  openingHoursOsm: string | null,
  now: Date,
  place: Coordinates = {},
): IsOpenResult {
  return evaluateHours(openingHoursOsm, now, place) ?? { open: false, closes_at: null };
}

// null means unreadable/unknown, not a confirmed closed schedule.
function evaluateHours(
  openingHoursOsm: string | null,
  now: Date,
  place: Coordinates,
): IsOpenResult | null {
  if (!openingHoursOsm || openingHoursOsm.trim() === '') {
    return null;
  }
  const conf = { tag_key: 'opening_hours', locale: 'es' } as never;
  try {
    // Solar rules need a timezone-aware astronomical evaluator. Until then,
    // report unknown rather than silently using a Madrid sunrise nationwide.
    if (/\b(sunrise|sunset|dawn|dusk)\b/.test(openingHoursOsm)) return null;
    const localNow = wallClockDate(now, timeZoneForPlace(place));
    let oh: OpeningHours;
    try {
      oh = new OpeningHours(openingHoursOsm, undefined, conf);
    } catch {
      oh = new OpeningHours(
        openingHoursOsm,
        {
          ...ES_NOMINATIM,
          lat: place.lat ?? ES_NOMINATIM.lat,
          lon: place.lng ?? ES_NOMINATIM.lon,
        } as never,
        conf,
      );
    }
    if (oh.getUnknown(localNow)) return null;
    const open = oh.getState(localNow);
    if (!open) return { open: false, closes_at: null };
    const nextChange = oh.getNextChange(localNow) as Date | undefined;
    // A comment or an unknown interval can be the next change. Do not call
    // that a closing time unless it actually changes from open to closed.
    const closes_at =
      nextChange && !oh.getState(nextChange) && !oh.getUnknown(nextChange)
        ? `${String(nextChange.getHours()).padStart(2, '0')}:${String(nextChange.getMinutes()).padStart(2, '0')}`
        : null;
    return { open: true, closes_at };
  } catch {
    return null;
  }
}

// --- combined verdict ------------------------------------------------------

/**
 * Beer-availability verdict for a place at `now`. Encodes:
 * - No category-based schedules: absence is unknown, never open/closed.
 * - Fuel opening_hours describe pumps, not a shop. Only reviewed shop hours
 *   may establish an open-now recommendation for a combined fuel POI.
 * - Bar serving on-site → not subject to the takeaway ordinance.
 * - Shop with takeaway-beer flag → subject to the ordinance.
 * - Shop without takeaway-beer flag → never sells beer.
 */
export function canSellBeerNow(place: PlaceForOpenNow, now: Date): CanSellBeerResult {
  const onsite = place.sells_onsite_beer ?? place.place_type === 'bar';
  const sale_policy = onsite
    ? 'not_applicable'
    : isMadridMunicipality(place)
      ? 'madrid_general'
      : 'unknown';
  const unknown = (reason: string): CanSellBeerResult => ({
    open: false,
    status: 'unknown',
    closes_at: null,
    sells_beer_now: false,
    reason,
    hours_source: 'none',
    sale_policy,
  });
  const reviewed = place.reviewed_hours ? evaluateHours(place.reviewed_hours, now, place) : null;
  if (place.hours_disputed && !reviewed)
    return unknown('Horario señalado como incorrecto; pendiente de comprobar.');
  const osm =
    place.place_type === 'gasolinera' ? null : evaluateHours(place.opening_hours_osm, now, place);
  const observed = place.hours_web_observed_at
    ? new Date(place.hours_web_observed_at).getTime()
    : Number.NaN;
  const webFresh =
    Number.isFinite(observed) &&
    observed <= now.getTime() &&
    now.getTime() - observed <= 180 * 86_400_000;
  const web =
    place.place_type === 'gasolinera' || !webFresh
      ? null
      : evaluateHours(place.opening_hours_web ?? null, now, place);
  if (!reviewed && osm && web && osm.open !== web.open) {
    return unknown('Las fuentes discrepan sobre el horario; pendiente de comprobar.');
  }
  const verdict = reviewed ?? osm ?? web;
  const hours_source: HoursSource = reviewed ? 'reviewed' : osm ? 'osm' : web ? 'website' : 'none';
  if (!verdict)
    return unknown(
      place.place_type === 'gasolinera'
        ? 'Horario de la tienda no confirmado; el horario de los surtidores no es suficiente.'
        : 'Horario no confirmado.',
    );

  const { open, closes_at } = verdict;
  if (!open) {
    return {
      open: false,
      status: 'closed',
      closes_at: null,
      sells_beer_now: false,
      reason: 'Cerrado según su horario.',
      hours_source,
      sale_policy,
    };
  }

  // Bars consume on-site — ordinance doesn't apply.
  if (onsite) {
    return {
      open: true,
      status: 'open',
      closes_at,
      sells_beer_now: true,
      reason:
        'Abierto según su horario. La categoría indica que probablemente sirve cerveza; no es una comprobación en directo.',
      hours_source,
      sale_policy,
    };
  }

  // Non-bars: must have the takeaway-beer flag.
  if (!place.sells_takeaway_beer) {
    return {
      open: true,
      status: 'open',
      closes_at,
      sells_beer_now: false,
      reason: 'No consta venta de cerveza para llevar.',
      hours_source,
      sale_policy,
    };
  }

  // Madrid ordinance applies to non-bars.
  if (sale_policy === 'madrid_general' && isAlcoholTakeawayProhibited(now)) {
    return {
      open: true,
      status: 'open',
      closes_at,
      sells_beer_now: false,
      reason: `Ordenanza municipal: restricción general en Madrid de ${ORDINANCE.label}; puede haber excepciones por licencia.`,
      hours_source,
      sale_policy,
    };
  }

  return {
    open: true,
    status: 'open',
    closes_at,
    sells_beer_now: true,
    reason:
      sale_policy === 'unknown'
        ? 'Abierto según su horario. Venta para llevar sujeta a normativa local no evaluada; disponibilidad de cerveza no comprobada en directo.'
        : 'Abierto según su horario. Venta de cerveza para llevar probable por su categoría, no comprobada en directo.',
    hours_source,
    sale_policy,
  };
}
