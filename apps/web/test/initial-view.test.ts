import { describe, expect, it } from 'vitest';
import {
  CANARY_VIEW,
  MAINLAND_VIEW,
  chooseOpeningView,
  loadStoredMapView,
  saveMapView,
} from '../src/initial-view.js';

const madridGeo = {
  lat: 40.4168,
  lng: -3.7038,
  city: 'Madrid',
  source: 'ip' as const,
};

const tenerifeGeo = {
  lat: 28.4853,
  lng: -16.3201,
  city: 'San Cristóbal de La Laguna',
  source: 'ip' as const,
};

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
};

describe('initial map view', () => {
  it('rejects a Canary IP result for a Europe/Madrid browser', () => {
    expect(chooseOpeningView(tenerifeGeo, 'Europe/Madrid', null)).toEqual(MAINLAND_VIEW);
  });

  it('rejects a mainland IP result for an Atlantic/Canary browser', () => {
    expect(chooseOpeningView(madridGeo, 'Atlantic/Canary', null)).toEqual(CANARY_VIEW);
  });

  it('uses the Canary regional fallback without a usable IP result', () => {
    expect(chooseOpeningView(null, 'Atlantic/Canary', null)).toEqual(CANARY_VIEW);
  });

  it('uses a conservative zoom for a region-consistent city result', () => {
    expect(chooseOpeningView(madridGeo, 'Europe/Madrid', null)).toEqual({
      longitude: -3.7038,
      latitude: 40.4168,
      zoom: 10,
    });
  });

  it('uses an even wider zoom when the IP database has no city', () => {
    expect(chooseOpeningView({ ...madridGeo, city: null }, 'Europe/Madrid', null)).toMatchObject({
      zoom: 8,
    });
  });

  it('prefers a recent user-selected view over IP inference', () => {
    const saved = { longitude: -0.3763, latitude: 39.4699, zoom: 14 };
    expect(chooseOpeningView(tenerifeGeo, 'Europe/Madrid', saved)).toEqual(saved);
  });
});

describe('stored map view', () => {
  it('round-trips a valid view', () => {
    const storage = memoryStorage();
    const view = { longitude: -3.7038, latitude: 40.4168, zoom: 13.5 };
    saveMapView(storage, view, 1_000);
    expect(loadStoredMapView(storage, 2_000)).toEqual(view);
  });

  it('ignores expired, malformed and out-of-scope values', () => {
    const expired = memoryStorage();
    saveMapView(expired, { longitude: -3.7, latitude: 40.4, zoom: 12 }, 1);
    expect(loadStoredMapView(expired, 100 * 24 * 60 * 60 * 1000)).toBeNull();

    const malformed = memoryStorage();
    malformed.setItem('cervezadonde:last-map-view:v1', '{');
    expect(loadStoredMapView(malformed, 2_000)).toBeNull();

    const outsideSpain = memoryStorage();
    saveMapView(outsideSpain, { longitude: 2.3522, latitude: 48.8566, zoom: 12 }, 1_000);
    expect(loadStoredMapView(outsideSpain, 2_000)).toBeNull();
  });
});
