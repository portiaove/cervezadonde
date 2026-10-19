import type {
  ClusterResponse,
  Intent,
  MapResponse,
  NearbyResponse,
  PlaceType,
} from '@cervezadonde/shared';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export async function reportPlace(
  id: string,
  kind: import('@cervezadonde/shared').PlaceReport['kind'],
) {
  const res = await fetch(`${API_URL}/stores/${encodeURIComponent(id)}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 202) throw new Error('report failed');
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`${path.split('?')[0]} failed: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

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

const clampLat = (v: number): number => Math.max(-90, Math.min(90, v));
const clampLng = (v: number): number => Math.max(-180, Math.min(180, v));

export async function fetchMap(
  bounds: Bounds,
  filters: Filters = {},
  limit = 2000,
  signal?: AbortSignal,
): Promise<MapResponse> {
  // At wide zoom MapLibre's bounds overflow ±90/±180; clamp so the API (which
  // validates the range) doesn't 400 and leave the map empty.
  const qs = new URLSearchParams({
    north: clampLat(bounds.north).toString(),
    south: clampLat(bounds.south).toString(),
    east: clampLng(bounds.east).toString(),
    west: clampLng(bounds.west).toString(),
    limit: limit.toString(),
  });
  applyFilters(qs, filters);
  return getJson(`/stores/map?${qs.toString()}`, signal);
}

export async function fetchClusters(
  bounds: Bounds,
  cell: number,
  filters: Filters = {},
  signal?: AbortSignal,
): Promise<ClusterResponse> {
  const qs = new URLSearchParams({
    north: clampLat(bounds.north).toString(),
    south: clampLat(bounds.south).toString(),
    east: clampLng(bounds.east).toString(),
    west: clampLng(bounds.west).toString(),
    cell: cell.toString(),
  });
  // open_now can't be aggregated server-side; the rest of the filters apply.
  applyFilters(qs, { ...filters, open_now: false });
  return getJson(`/stores/clusters?${qs.toString()}`, signal);
}

/** Dataset freshness + size, from the API's /meta endpoint. */
export type MetaResponse = {
  data_updated_at: string | null;
  active_stores: number;
  stores_with_hours: number;
};

export async function fetchMeta(): Promise<MetaResponse> {
  return getJson('/meta');
}

/** Approximate, IP-based location for the initial map centre (city-level). */
export type GeoResponse = {
  lat: number | null;
  lng: number | null;
  city: string | null;
  source: 'ip' | 'none';
};

export async function fetchGeo(): Promise<GeoResponse> {
  return getJson('/geo');
}

export async function fetchNearby(
  center: { lat: number; lng: number; radius_m?: number; limit?: number },
  filters: Filters = {},
  signal?: AbortSignal,
): Promise<NearbyResponse> {
  const qs = new URLSearchParams({
    lat: center.lat.toString(),
    lng: center.lng.toString(),
    radius_m: (center.radius_m ?? 2000).toString(),
    limit: (center.limit ?? 50).toString(),
  });
  applyFilters(qs, filters);
  return getJson(`/stores/nearby?${qs.toString()}`, signal);
}
