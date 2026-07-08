import type {
  MapResponse,
  MapStore,
  NearbyResponse,
  NearbyStore,
} from '@minimarket/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export async function fetchNearby(params: {
  lat: number;
  lng: number;
  radius_m?: number;
  limit?: number;
}): Promise<NearbyStore[]> {
  const qs = new URLSearchParams({
    lat: params.lat.toString(),
    lng: params.lng.toString(),
    radius_m: (params.radius_m ?? 1500).toString(),
    limit: (params.limit ?? 100).toString(),
  });
  const res = await fetch(`${API_URL}/stores/nearby?${qs.toString()}`);
  if (!res.ok) throw new Error(`nearby failed: ${res.status}`);
  const json = (await res.json()) as NearbyResponse;
  return json.results;
}

export async function fetchMap(params: {
  north: number;
  south: number;
  east: number;
  west: number;
  limit?: number;
  hide_chains?: boolean;
}): Promise<MapStore[]> {
  const qs = new URLSearchParams({
    north: params.north.toString(),
    south: params.south.toString(),
    east: params.east.toString(),
    west: params.west.toString(),
    limit: (params.limit ?? 1000).toString(),
  });
  if (params.hide_chains) qs.set('hide_chains', 'true');
  const res = await fetch(`${API_URL}/stores/map?${qs.toString()}`);
  if (!res.ok) throw new Error(`map failed: ${res.status}`);
  const json = (await res.json()) as MapResponse;
  return json.results;
}
