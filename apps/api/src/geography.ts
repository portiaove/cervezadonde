import madrid from './data/madrid-municipality.json' with { type: 'json' };

export type Coordinates = { lat?: number; lng?: number };

export function timeZoneForPlace({ lat, lng }: Coordinates): string {
  return lat !== undefined &&
    lng !== undefined &&
    lat >= 27.5 &&
    lat <= 29.6 &&
    lng >= -18.3 &&
    lng <= -13.2
    ? 'Atlantic/Canary'
    : 'Europe/Madrid';
}

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [ax = 0, ay = 0] = a;
    const [bx = 0, by = 0] = b;
    if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Exact IGN municipal geometry, not a rectangle that includes neighbouring towns. */
export function isMadridMunicipality({ lat, lng }: Coordinates): boolean {
  if (
    lat === undefined ||
    lng === undefined ||
    lat < 40.3 ||
    lat > 40.65 ||
    lng < -3.9 ||
    lng > -3.5
  )
    return false;
  return madrid.geometry.coordinates.some(
    ([outer, ...holes]) =>
      outer && inRing(lng, lat, outer) && !holes.some((hole) => inRing(lng, lat, hole)),
  );
}
