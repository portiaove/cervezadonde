import type { GeoResponse } from './api.js';

export type PointView = {
  longitude: number;
  latitude: number;
  zoom: number;
};

export type BoundsView = {
  bounds: [[number, number], [number, number]];
  fitBoundsOptions: { padding: number };
};

export type OpeningView = PointView | BoundsView;

type BrowserRegion = 'canary' | 'mainland' | null;

const SPAIN_BBOX = { minLat: 27.5, maxLat: 43.9, minLng: -18.3, maxLng: 4.5 };
const CANARY_BBOX = { minLat: 27.5, maxLat: 29.6, minLng: -18.3, maxLng: -13.2 };

// DB-IP City Lite has no accuracy radius. Even when it supplies a city, treat
// the point as a weak hint and show the surrounding urban area, not a street.
const IP_CITY_ZOOM = 10;
const IP_REGION_ZOOM = 8;

export const MAINLAND_VIEW: BoundsView = {
  bounds: [
    [-9.5, 35.9],
    [4.5, 43.9],
  ],
  fitBoundsOptions: { padding: 24 },
};

export const CANARY_VIEW: BoundsView = {
  bounds: [
    [-18.3, 27.5],
    [-13.2, 29.6],
  ],
  fitBoundsOptions: { padding: 24 },
};

const VIEW_STORAGE_KEY = 'cervezadonde:last-map-view:v1';
const VIEW_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type StoredView = PointView & {
  version: 1;
  savedAt: number;
};

type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isInBox = (
  lat: number,
  lng: number,
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;

export const isCanaryCoordinate = (lat: number, lng: number): boolean =>
  isInBox(lat, lng, CANARY_BBOX);

const browserRegion = (timeZone: string | null): BrowserRegion => {
  if (timeZone === 'Atlantic/Canary') return 'canary';
  if (timeZone === 'Europe/Madrid') return 'mainland';
  return null;
};

const fallbackFor = (region: BrowserRegion): BoundsView =>
  region === 'canary' ? CANARY_VIEW : MAINLAND_VIEW;

export function chooseOpeningView(
  geo: GeoResponse | null,
  timeZone: string | null,
  savedView: PointView | null,
): OpeningView {
  // A recent view reflects an area the user actually chose, so it is stronger
  // evidence than an ISP-level IP database.
  if (savedView) return savedView;

  const region = browserRegion(timeZone);
  if (
    geo?.source !== 'ip' ||
    !isFiniteNumber(geo.lat) ||
    !isFiniteNumber(geo.lng) ||
    !isInBox(geo.lat, geo.lng, SPAIN_BBOX)
  ) {
    return fallbackFor(region);
  }

  const geoRegion: Exclude<BrowserRegion, null> = isCanaryCoordinate(geo.lat, geo.lng)
    ? 'canary'
    : 'mainland';

  // Europe/Madrid and Atlantic/Canary cannot identify a city, but they can
  // reject a clearly inconsistent IP result without asking for GPS permission.
  if (region && region !== geoRegion) return fallbackFor(region);

  return {
    longitude: geo.lng,
    latitude: geo.lat,
    zoom: geo.city ? IP_CITY_ZOOM : IP_REGION_ZOOM,
  };
}

export function loadStoredMapView(storage: ViewStorage, now = Date.now()): PointView | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(VIEW_STORAGE_KEY) ?? 'null',
    ) as Partial<StoredView> | null;
    if (
      parsed?.version !== 1 ||
      !isFiniteNumber(parsed.longitude) ||
      !isFiniteNumber(parsed.latitude) ||
      !isFiniteNumber(parsed.zoom) ||
      !isFiniteNumber(parsed.savedAt) ||
      parsed.savedAt > now ||
      now - parsed.savedAt > VIEW_MAX_AGE_MS ||
      parsed.zoom < 4 ||
      parsed.zoom > 19 ||
      !isInBox(parsed.latitude, parsed.longitude, SPAIN_BBOX)
    ) {
      return null;
    }
    return {
      longitude: parsed.longitude,
      latitude: parsed.latitude,
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

export function saveMapView(storage: ViewStorage, view: PointView, now = Date.now()): void {
  if (
    !isFiniteNumber(view.longitude) ||
    !isFiniteNumber(view.latitude) ||
    !isFiniteNumber(view.zoom) ||
    !isInBox(view.latitude, view.longitude, SPAIN_BBOX)
  ) {
    return;
  }
  try {
    const stored: StoredView = { ...view, version: 1, savedAt: now };
    storage.setItem(VIEW_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage may be disabled or full; opening the map must still work.
  }
}
