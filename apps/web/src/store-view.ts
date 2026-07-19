import type { MapStore, NearbyStore, PlaceType } from '@cervezadonde/shared';

export type AnyStore = MapStore | NearbyStore;

/** Consumption intent: barra = drink on-site, lata = takeaway. */
export type MarkerIntent = 'barra' | 'lata' | 'otro';

/** Open-now state used to colour rings and write copy. */
export type MarkerState = 'open' | 'estimated' | 'ordinance' | 'closed' | 'unconfirmed';

export function intentOf(s: AnyStore): MarkerIntent {
  if (s.sells_onsite_beer) return 'barra';
  if (s.sells_takeaway_beer) return 'lata';
  return 'otro';
}

export function statusOf(s: AnyStore): MarkerState {
  const { open, sells_beer_now, reason, hours_source } = s.open_now;
  if (hours_source === 'none') return 'unconfirmed';
  // Open per default schedule (no real hours) → "suele estar abierto".
  if (sells_beer_now) return hours_source === 'estimated' ? 'estimated' : 'open';
  // Open, but the takeaway ordinance is blocking a sale right now.
  if (open && reason.toLowerCase().includes('ordenanza')) return 'ordinance';
  return 'closed';
}

// Marker fill = intent (the lata/barra distinction the legend explains).
export const INTENT_COLOR: Record<MarkerIntent, string> = {
  barra: '#c2410c', // burnt amber
  lata: '#1d4ed8', // blue
  otro: '#64748b', // slate
};

// Marker ring = whether it can serve/sell a beer right now.
export const STATE_RING: Record<MarkerState, string> = {
  open: '#16a34a', // green — confirmed hours
  estimated: '#4ade80', // lighter green — default schedule, "suele estar abierto"
  ordinance: '#f59e0b', // amber warning
  unconfirmed: '#cbd5e1', // light grey
  closed: '#ffffff',
};

export const INTENT_LABEL: Record<MarkerIntent, string> = {
  barra: 'En barra · para tomar',
  lata: 'En lata · para llevar',
  otro: 'Otro',
};

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  bar: 'Bar',
  supermercado: 'Supermercado',
  alimentacion: 'Alimentación',
  bodega: 'Bodega',
  tienda_24h: 'Tienda 24h',
  gasolinera: 'Gasolinera',
  otro: 'Local',
};

export function placeTypeLabel(s: AnyStore): string {
  return s.place_type ? PLACE_TYPE_LABEL[s.place_type] : 'Local';
}

/** Short human line for the place card, e.g. "Bar · En barra". */
export function subtitle(s: AnyStore): string {
  const intent = intentOf(s);
  const intentShort = intent === 'barra' ? 'En barra' : intent === 'lata' ? 'En lata' : null;
  return [placeTypeLabel(s), intentShort].filter(Boolean).join(' · ');
}

/**
 * Honest label when the "nearest open" answer is a fallback: a place that only
 * exists in an official censo, not corroborated in OSM (existence not
 * independently confirmed — it may have closed without the licence being
 * deregistered). Returns null for verified/mapped places (nothing to flag).
 */
export function unverifiedNote(s: Pick<NearbyStore, 'verification'>): string | null {
  return s.verification === 'unverified'
    ? 'Sin confirmar — solo en el censo oficial, sin verificar en el mapa'
    : null;
}
export function directionsUrl(s: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
}
