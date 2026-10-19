import assert from 'node:assert/strict';
import { ClusterResponse, MapResponse, NearbyResponse } from '@cervezadonde/shared';

const base = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');
const get = async (path: string) => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
};

assert.equal((await get('/health/db')).ok, true);
const meta = await get('/meta');
assert.ok(meta.active_stores > 100_000, 'national serving inventory unexpectedly small');
assert.ok(meta.stores_with_hours > 20_000, 'hours coverage unexpectedly small');

const places = [
  ['Madrid', 40.4168, -3.7038],
  ['Barcelona', 41.3874, 2.1686],
  ['Sevilla', 37.3891, -5.9845],
  ['Bilbao', 43.263, -2.935],
  ['Palma', 39.5696, 2.6502],
  ['Tenerife', 28.467, -16.25],
  ['Las Palmas', 28.1248, -15.43],
  ['Ceuta', 35.888, -5.317],
  ['Melilla', 35.292, -2.938],
] as const;
const summary: Record<string, number> = {};
for (const [name, lat, lng] of places) {
  const data = NearbyResponse.parse(
    await get(
      `/stores/nearby?lat=${lat}&lng=${lng}&radius_m=3000&limit=20&open_now=false&hide_chains=false&at_time=2026-10-19T21:30:00Z`,
    ),
  );
  assert.ok(data.results.length > 0, `${name}: no nearby places`);
  assert.ok(
    data.results.every((store) => store.verification !== 'unverified'),
    `${name}: unpublished source leaked`,
  );
  assert.ok(
    data.results.every((store) => store.open_now.sale_policy !== undefined),
    `${name}: missing policy context`,
  );
  if (name !== 'Madrid') {
    assert.equal(data.ordinance.takeaway_allowed, null, `${name}: Madrid policy leaked`);
    assert.ok(data.results.every((store) => store.open_now.sale_policy !== 'madrid_general'));
  }
  summary[name] = data.results.length;
}

const map = MapResponse.parse(
  await get(
    '/stores/map?north=40.43&south=40.40&east=-3.68&west=-3.73&limit=100&open_now=false&at_time=2026-10-19T03:30:00Z',
  ),
);
assert.ok(map.results.length > 0);
assert.ok(
  map.results.some((store) => !store.open_now.sells_beer_now),
  'open_now=false unexpectedly filtered out closed places',
);
const open = MapResponse.parse(
  await get(
    '/stores/map?north=40.43&south=40.40&east=-3.68&west=-3.73&limit=100&open_now=true&at_time=2026-10-19T12:00:00Z',
  ),
);
assert.ok(open.results.every((store) => store.open_now.sells_beer_now));
assert.ok(open.results.length > 0);
const clusters = ClusterResponse.parse(
  await get('/stores/clusters?north=44&south=35&east=5&west=-10&cell=1&hide_chains=false'),
);
assert.ok(clusters.clusters.reduce((sum, cluster) => sum + cluster.count, 0) > 100_000);
const invalid = await fetch(`${base}/stores/map?north=40&south=39&east=-3&west=-4&open_now=no`);
assert.equal(invalid.status, 400);

const webBase = process.argv[3];
if (webBase) {
  const home = await fetch(webBase, { signal: AbortSignal.timeout(20_000) });
  assert.equal(home.status, 200);
  assert.ok(home.headers.get('cache-control')?.includes('no-cache'));
  const html = await home.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length >= 2, 'missing JS/CSS references');
  for (const asset of assets) {
    const response = await fetch(new URL(asset, webBase), {
      method: 'HEAD',
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, 200, `missing asset ${asset}`);
    assert.ok(response.headers.get('cache-control')?.includes('immutable'));
    assert.ok(
      !response.headers.get('content-type')?.includes('text/html'),
      `HTML served for ${asset}`,
    );
  }
  const missing = await fetch(new URL('/assets/nonexistent-smoke-probe.js', webBase), {
    method: 'HEAD',
  });
  assert.equal(missing.status, 404, 'missing script incorrectly used SPA fallback');
  const tile = await fetch('https://a.basemaps.cartocdn.com/light_all/10/501/385@2x.png', {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get('access-control-allow-origin'), '*');
  const signature = new Uint8Array(await tile.arrayBuffer()).slice(0, 8);
  assert.deepEqual([...signature], [137, 80, 78, 71, 13, 10, 26, 10], 'invalid map tile');
  const search = await fetch('https://photon.komoot.io/api?q=Madrid&limit=1', {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(search.status, 200);
  assert.ok((await search.json()).features.length > 0, 'geocoder returned no results');
}
console.log(
  JSON.stringify(
    {
      ok: true,
      base,
      web: webBase ?? null,
      meta,
      nearby: summary,
      map: map.results.length,
      open: open.results.length,
      clusters: clusters.clusters.length,
    },
    null,
    2,
  ),
);
