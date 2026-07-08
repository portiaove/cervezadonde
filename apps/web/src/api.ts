import type { Intent, MapResponse, NearbyResponse, PlaceType } from '@cervezadonde/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/** Filters shared by the map and nearby endpoints. */
export type Filters = {
  open_now?: boolean;
  intent?: Intent;
  hide_chains?: boolean;
  place_type?: PlaceType[];
  at_time?: string;
};

const applyFilters = (qs: URLSearchParams, f: Filters): void => {
  if (f.open_now) qs.set('open_now', 'true');
  if (f.intent) qs.set('intent', f.intent);
  if (f.hide_chains) qs.set('hide_chains', 'true');
  if (f.place_type && f.place_type.length > 0) {
    qs.set('place_type', f.place_type.join(','));
  }
  if (f.at_time) qs.set('at_time', f.at_time);
};

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export async function fetchMap(
  bounds: Bounds,
  filters: Filters = {},
  limit = 1500,
): Promise<MapResponse> {
  const qs = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
    limit: limit.toString(),
  });
  applyFilters(qs, filters);
  const res = await fetch(`${API_URL}/stores/map?${qs.toString()}`);
  if (!res.ok) throw new Error(`map failed: ${res.status}`);
  return (await res.json()) as MapResponse;
}

export async function fetchNearby(
  center: { lat: number; lng: number; radius_m?: number; limit?: number },
  filters: Filters = {},
): Promise<NearbyResponse> {
  const qs = new URLSearchParams({
    lat: center.lat.toString(),
    lng: center.lng.toString(),
    radius_m: (center.radius_m ?? 2000).toString(),
    limit: (center.limit ?? 50).toString(),
  });
  applyFilters(qs, filters);
  const res = await fetch(`${API_URL}/stores/nearby?${qs.toString()}`);
  if (!res.ok) throw new Error(`nearby failed: ${res.status}`);
  return (await res.json()) as NearbyResponse;
}
