import type { MapStore, NearbyStore, PlaceType } from '@cervezadonde/shared';

export type AnyStore = MapStore | NearbyStore;

/** Consumption intent: barra = drink on-site, lata = takeaway. */
export type MarkerIntent = 'barra' | 'lata' | 'otro';

/** Open-now state used to colour rings and write copy. */
export type MarkerState = 'open' | 'ordinance' | 'closed' | 'unconfirmed';

export const UNCONFIRMED_REASON = 'Horario no confirmado.';

export function intentOf(s: AnyStore): MarkerIntent {
  if (s.sells_onsite_beer) return 'barra';
  if (s.sells_takeaway_beer) return 'lata';
  return 'otro';
}

export function statusOf(s: AnyStore): MarkerState {
  const { open, sells_beer_now, reason } = s.open_now;
  if (reason === UNCONFIRMED_REASON) return 'unconfirmed';
  if (sells_beer_now) return 'open';
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
  open: '#16a34a', // green
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
 * Cross-platform "cómo llegar" link. The Google Maps universal URL opens the
 * native maps app on iOS/Android and the web on desktop.
 */
export function directionsUrl(s: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
}
