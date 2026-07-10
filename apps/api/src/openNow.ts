// Open-now evaluator and Madrid alcohol-sale ordinance check.
// See docs/04-domain-model.md (canSellBeerNow) and decisions/ADR-004.
//
// Pure functions. Europe/Madrid timezone. No DB access.
// The ordinance window (22:00 → 09:00) and the local time arithmetic are
// the *only* place these rules live in the codebase.
//
// ⚠ TZ requirement: the opening_hours library evaluates rule times against
// the PROCESS's wall clock. The API must run with TZ=Europe/Madrid (set in
// deploy/docker-compose.prod.yml) or every verdict shifts by 1–2 hours.

import OpeningHours from 'opening_hours';

export const MADRID_TZ = 'Europe/Madrid';

/** Window during which takeaway alcohol sales are prohibited (Madrid ordinance). */
export const ORDINANCE = {
  startHour: 22,
  endHour: 9,
  label: '22:00–09:00',
} as const;

export type PlaceForOpenNow = {
  place_type: 'bar' | 'supermercado' | 'alimentacion' | 'bodega' | 'tienda_24h' | 'otro';
  sells_takeaway_beer: boolean;
  opening_hours_osm: string | null;
  /** Hours crawled from the business website (crawl:hours). Optional for callers without it. */
  opening_hours_web?: string | null;
};

export type IsOpenResult = {
  open: boolean;
  closes_at: string | null;
};

export type HoursSource = 'osm' | 'website' | 'estimated' | 'none';

export type CanSellBeerResult = {
  open: boolean;
  closes_at: string | null;
  sells_beer_now: boolean;
  reason: string;
  hours_source: HoursSource;
};

/**
 * Typical Spanish schedules per place_type, applied ONLY when a place has no
 * real hours — and always labelled "horario habitual (no confirmado)" in the
 * verdict, never presented as confirmed. Standard OSM opening_hours syntax so
 * they flow through the same parser as real data. 'otro' gets no estimate.
 */
export const DEFAULT_HOURS_BY_TYPE: Record<PlaceForOpenNow['place_type'], string | null> = {
  bar: 'Mo-Th 09:00-01:00; Fr-Sa 09:00-02:00; Su 10:00-24:00',
  supermercado: 'Mo-Sa 09:00-21:30; Su 10:00-15:00',
  alimentacion: 'Mo-Su 10:00-22:00',
  bodega: 'Mo-Sa 10:00-14:00,17:00-20:30',
  tienda_24h: '24/7',
  otro: null,
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
export function isOpenNow(openingHoursOsm: string | null, now: Date): IsOpenResult {
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
 * - Real OSM hours when present; otherwise the place_type's default schedule,
 *   flagged hours_source='estimated' ("suele estar abierto/cerrado").
 * - No hours and no default → "horario no confirmado" (hours_source='none').
 * - Bar serving on-site → not subject to the takeaway ordinance.
 * - Shop with takeaway-beer flag → subject to the ordinance.
 * - Shop without takeaway-beer flag → never sells beer.
 */
export function canSellBeerNow(place: PlaceForOpenNow, now: Date): CanSellBeerResult {
  // Confirmed hours: OSM first (community-curated), then the business's own
  // website (crawl:hours); only without both does the estimate kick in.
  const osmHours = place.opening_hours_osm?.trim() || null;
  const webHours = place.opening_hours_web?.trim() || null;
  const realHours = osmHours ?? webHours;
  const hours = realHours ?? DEFAULT_HOURS_BY_TYPE[place.place_type];
  const hours_source: HoursSource = osmHours
    ? 'osm'
    : webHours
      ? 'website'
      : hours
        ? 'estimated'
        : 'none';
  const estimated = hours_source === 'estimated';

  // No hours and no sensible default — be conservative, don't claim anything.
  if (!hours) {
    return {
      open: false,
      closes_at: null,
      sells_beer_now: false,
      reason: 'Horario no confirmado.',
      hours_source,
    };
  }

  const { open, closes_at } = isOpenNow(hours, now);
  if (!open) {
    return {
      open: false,
      closes_at: null,
      sells_beer_now: false,
      reason: estimated ? 'Suele estar cerrado a esta hora (horario no confirmado).' : 'Cerrado.',
      hours_source,
    };
  }

  // Bars consume on-site — ordinance doesn't apply.
  if (place.place_type === 'bar') {
    return {
      open: true,
      closes_at,
      sells_beer_now: true,
      reason: estimated
        ? 'Suele estar abierto a esta hora (horario no confirmado).'
        : hours_source === 'website'
          ? 'Bar abierto (horario de su web).'
          : 'Bar abierto en horario habitual.',
      hours_source,
    };
  }

  // Non-bars: must have the takeaway-beer flag.
  if (!place.sells_takeaway_beer) {
    return {
      open: true,
      closes_at,
      sells_beer_now: false,
      reason: 'No vende alcohol para llevar.',
      hours_source,
    };
  }

  // Madrid ordinance applies to non-bars.
  if (isAlcoholTakeawayProhibited(now)) {
    return {
      open: true,
      closes_at,
      sells_beer_now: false,
      reason: `Ordenanza municipal: no puede vender alcohol para llevar de ${ORDINANCE.label}.`,
      hours_source,
    };
  }

  return {
    open: true,
    closes_at,
    sells_beer_now: true,
    reason: estimated
      ? 'Suele estar abierto (horario no confirmado). Puede venderte cerveza para llevar.'
      : hours_source === 'website'
        ? 'Abierto (horario de su web). Puede venderte cerveza para llevar.'
        : 'Abierto. Puede venderte cerveza para llevar.',
    hours_source,
  };
}
