import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { type CityResponse, type Reader, open, validate } from 'maxmind';

// Approximate, IP-based geolocation so the map can open roughly on the
// visitor's city instead of always Madrid. City-level only; the precise
// "Cerca de mí" (GPS) button stays the accurate upgrade. Everything happens
// on our own VPS against the DB-IP City Lite database already shipped for
// analytics (deploy/geoip) — the IP never leaves the server and nothing is
// stored.

// Rough bounding box of Spain incl. Canarias, Baleares and Ceuta/Melilla.
// Lookups outside it (visitors abroad, VPNs in other countries) are discarded
// so the map falls back to the default centre instead of, say, Berlin.
const SPAIN_BBOX = { minLat: 27.5, maxLat: 43.9, minLng: -18.3, maxLng: 4.4 };

export type GeoResult = {
  lat: number | null;
  lng: number | null;
  city: string | null;
  source: 'ip' | 'none';
};

const NO_GEO: GeoResult = { lat: null, lng: null, city: null, source: 'none' };

let reader: Reader<CityResponse> | null = null;
let loaded = false;

async function getReader(app: FastifyInstance): Promise<Reader<CityResponse> | null> {
  if (loaded) return reader;
  loaded = true;
  const dbPath = process.env.GEOIP_DB;
  if (!dbPath || !existsSync(dbPath)) {
    // Not fatal: /geo just returns null and the client keeps the default centre
    // (e.g. local dev where GEOIP_DB isn't set).
    app.log.warn({ dbPath }, 'GEOIP_DB not set or file missing; /geo will return null');
    return null;
  }
  try {
    reader = await open<CityResponse>(dbPath);
    app.log.info({ dbPath }, 'GeoIP database loaded');
  } catch (err) {
    app.log.error({ err, dbPath }, 'failed to open GeoIP database');
    reader = null;
  }
  return reader;
}

export async function registerGeoRoutes(app: FastifyInstance): Promise<void> {
  // Warm the reader at startup so the first request is fast and any config
  // problem surfaces in the logs immediately.
  await getReader(app);

  app.get('/geo', async (req): Promise<GeoResult> => {
    const r = await getReader(app);
    if (!r) return NO_GEO;

    // req.ip honours X-Forwarded-For because the server runs with trustProxy;
    // Caddy appends the real client IP. Spoofing only mis-centres the caller's
    // own map, so no stronger validation is needed here.
    const ip = req.ip;
    if (!ip || !validate(ip)) return NO_GEO;

    try {
      const res = r.get(ip);
      const lat = res?.location?.latitude;
      const lng = res?.location?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return NO_GEO;

      const inSpain =
        lat >= SPAIN_BBOX.minLat &&
        lat <= SPAIN_BBOX.maxLat &&
        lng >= SPAIN_BBOX.minLng &&
        lng <= SPAIN_BBOX.maxLng;
      if (!inSpain) return NO_GEO;

      const names = res?.city?.names as Record<string, string> | undefined;
      const city = names?.es ?? names?.en ?? null;
      return { lat, lng, city, source: 'ip' };
    } catch (err) {
      app.log.warn({ err }, 'geo lookup failed');
      return NO_GEO;
    }
  });
}
