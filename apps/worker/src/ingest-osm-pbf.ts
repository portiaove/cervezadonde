// OSM-canonical ingest from a Geofabrik .osm.pbf extract, filtered locally with
// osmium (run in Docker). This is the national-scale path (ADR-007): one
// uniform dataset per region/country, no dependence on Overpass.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { getSql } from '@cervezadonde/db';
import { downloadIfNeeded } from './download.js';
import { persistOsmCanonical } from './ingest-osm-canonical.js';
import { getCacheDir } from './sources/madrid.js';
import {
  OSM_AMENITY_VALUES,
  OSM_SHOP_VALUES,
  type OsmPlace,
  normalizeName,
} from './sources/osm.js';

const execFileP = promisify(execFile);
const OSMIUM_IMAGE = 'cervezadonde-osmium';

/** Geofabrik extract per region. */
export const REGION_PBF: Record<string, string> = {
  'comunidad-madrid': 'https://download.geofabrik.de/europe/spain/madrid-latest.osm.pbf',
  cataluna: 'https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf',
  spain: 'https://download.geofabrik.de/europe/spain-latest.osm.pbf',
  'canary-islands': 'https://download.geofabrik.de/africa/canary-islands-latest.osm.pbf',
};

/** Geofabrik's Spain file excludes Canarias. Both parts must succeed before national pruning. */
export function extractParts(region: string): Array<{ region: string; url: string }> {
  const parts = region === 'spain' ? ['spain', 'canary-islands'] : [region];
  return parts.map((part) => {
    const url = REGION_PBF[part];
    if (!url)
      throw new Error(`unknown region '${part}'. Known: ${Object.keys(REGION_PBF).join(', ')}`);
    return { region: part, url };
  });
}

export type IngestOsmPbfSummary = {
  importRunId: number;
  region: string;
  placesParsed: number;
  withHours: number;
  byType: Record<string, number>;
  officialFlagged: number;
  censoMatched: number;
  pruned: number;
  durationMs: number;
};

/** Regions whose extract covers the whole country — safe to prune stale stores. */
const NATIONAL_REGIONS = new Set(['spain']);

/** Docker mounts want forward-slash paths, even on Windows. */
const dockerPath = (p: string): string => p.replace(/\\/g, '/');

async function ensureOsmiumImage(log: (m: string) => void): Promise<void> {
  try {
    await execFileP('docker', ['image', 'inspect', OSMIUM_IMAGE]);
  } catch {
    const repoRoot = resolve(process.cwd(), '..', '..');
    log(`building ${OSMIUM_IMAGE} image (one-time)...`);
    await execFileP('docker', [
      'build',
      '-t',
      OSMIUM_IMAGE,
      '-f',
      resolve(repoRoot, 'docker', 'osmium.Dockerfile'),
      resolve(repoRoot, 'docker'),
    ]);
  }
}

async function runOsmium(hostDataDir: string, args: string[]): Promise<void> {
  await execFileP('docker', [
    'run',
    '--rm',
    '-v',
    `${dockerPath(hostDataDir)}:/data`,
    OSMIUM_IMAGE,
    ...args,
  ]);
}

/** Representative point for any geometry: mean of all its coordinates. */
function centroid(geometry: { coordinates: unknown }): [number, number] | null {
  const pts: [number, number][] = [];
  const walk = (a: unknown): void => {
    if (
      Array.isArray(a) &&
      a.length === 2 &&
      typeof a[0] === 'number' &&
      typeof a[1] === 'number'
    ) {
      pts.push([a[0], a[1]]);
    } else if (Array.isArray(a)) {
      for (const x of a) walk(x);
    }
  };
  walk(geometry.coordinates);
  if (pts.length === 0) return null;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  return [sx / pts.length, sy / pts.length];
}

const OSM_TYPE: Record<string, OsmPlace['osmType']> = {
  n: 'node',
  w: 'way',
  a: 'way',
  r: 'relation',
};

// Only keep places whose tag is actually in our target set — osmium keeps
// referenced objects, which can carry unrelated amenity tags (bench, etc.).
const AMENITY_SET: ReadonlySet<string> = new Set(OSM_AMENITY_VALUES);
const SHOP_SET: ReadonlySet<string> = new Set(OSM_SHOP_VALUES);

const buildAddress = (props: Record<string, string>): string | null => {
  const joined = [props['addr:street'], props['addr:housenumber']].filter(Boolean).join(' ').trim();
  return joined || null;
};

/** Parse one osmium-export GeoJSON feature into an OsmPlace. */
export function featureToPlace(feature: {
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties?: Record<string, string | number>;
}): OsmPlace | null {
  const point = centroid(feature.geometry);
  if (!point) return null;
  const props = Object.fromEntries(
    Object.entries(feature.properties ?? {}).filter(
      ([key, value]) => !key.startsWith('@') && typeof value === 'string',
    ),
  ) as Record<string, string>;
  const timestamp = feature.properties?.['@timestamp'];
  const date =
    typeof timestamp === 'number'
      ? new Date(timestamp * 1000)
      : timestamp
        ? new Date(timestamp)
        : null;
  const okAmenity = props.amenity !== undefined && AMENITY_SET.has(props.amenity);
  const okShop = props.shop !== undefined && SHOP_SET.has(props.shop);
  // Retain fuel POIs as evidence, including non-retail pumps. The independent
  // beer policy hides unsupported candidates, rather than deleting them.
  const okFuel = props.amenity === 'fuel';
  if (!okAmenity && !okShop && !okFuel) return null;
  const id = feature.id ?? '';
  const osmType = OSM_TYPE[id[0] ?? ''] ?? 'node';
  const name = props.name ?? null;
  return {
    osmId: Number.parseInt(id.slice(1), 10) || 0,
    osmType,
    sourceLocalId: id,
    lon: point[0],
    lat: point[1],
    name,
    normalizedName: normalizeName(name),
    address: buildAddress(props),
    openingHours: props.opening_hours ?? null,
    shopTag: props.shop ?? null,
    amenityTag: props.amenity ?? null,
    tags: props,
    osmUpdatedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

export async function parseGeojsonl(path: string): Promise<OsmPlace[]> {
  const places: OsmPlace[] = [];
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const raw of rl) {
    const line = (raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw).trim(); // RFC 8142 separator
    if (!line) continue;
    try {
      const place = featureToPlace(JSON.parse(line));
      if (place) places.push(place);
    } catch {
      // skip malformed line
    }
  }
  return places;
}

export async function ingestOsmPbf(opts: {
  region?: string;
  fresh?: boolean;
  log?: (m: string) => void;
}): Promise<IngestOsmPbfSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const region = opts.region ?? 'comunidad-madrid';
  const parts = extractParts(region);

  const sql = getSql();
  const startedAt = Date.now();
  const cacheDir = getCacheDir();
  const hostDataDir = resolve(process.cwd(), cacheDir);

  await ensureOsmiumImage(log);
  const combined = new Map<string, OsmPlace>();
  const hashes: string[] = [];
  for (const part of parts) {
    if (opts.fresh) {
      const { unlink } = await import('node:fs/promises');
      await unlink(resolve(hostDataDir, `${part.region}.osm.pbf`)).catch(() => undefined);
    }
    const dl = await downloadIfNeeded({
      url: part.url,
      destDir: cacheDir,
      fileName: `${part.region}.osm.pbf`,
      log,
    });
    hashes.push(dl.hash);
    log(`extract ${part.region}: sha256=${dl.hash}`);
    log(`osmium: filtering bars + shops (${part.region})...`);
    await runOsmium(hostDataDir, [
      'tags-filter',
      '--overwrite',
      '-o',
      `/data/${part.region}-filtered.osm.pbf`,
      `/data/${part.region}.osm.pbf`,
      `nwr/amenity=${[...OSM_AMENITY_VALUES, 'fuel'].join(',')}`,
      `nwr/shop=${OSM_SHOP_VALUES.join(',')}`,
    ]);
    log(`osmium: exporting GeoJSON (${part.region})...`);
    await runOsmium(hostDataDir, [
      'export',
      '--overwrite',
      '-o',
      `/data/${part.region}.geojsonl`,
      '-f',
      'geojsonseq',
      '--add-unique-id=type_id',
      '--attributes=timestamp,version',
      '--geometry-types=point,polygon',
      `/data/${part.region}-filtered.osm.pbf`,
    ]);
    const parsed = await parseGeojsonl(resolve(hostDataDir, `${part.region}.geojsonl`));
    if (parsed.length === 0)
      throw new Error(`empty extract ${part.region}; refusing national persistence/pruning`);
    log(`parsed ${parsed.length} places from ${part.region}`);
    for (const place of parsed)
      combined.set(place.sourceLocalId ?? `${place.osmType}/${place.osmId}`, place);
  }
  const places = [...combined.values()];
  const withHours = places.filter((p) => p.openingHours).length;
  log(`parsed ${places.length} places (${withHours} with hours)`);

  const { importRunId, byType, officialFlagged, censoMatched, pruned } = await persistOsmCanonical(
    sql,
    places,
    {
      sourceUrl: parts.map((part) => part.url).join('\n'),
      fileHash:
        hashes.length === 1
          ? (hashes[0] ?? '')
          : createHash('sha256').update(hashes.join('\n')).digest('hex'),
      rowCount: places.length,
      log,
      // Only a whole-Spain extract sees every store, so only it can tell a
      // vanished (closed) store from one that's simply out of the region.
      pruneStale: NATIONAL_REGIONS.has(region),
    },
  );

  return {
    importRunId,
    region,
    placesParsed: places.length,
    withHours,
    byType,
    officialFlagged,
    censoMatched,
    pruned,
    durationMs: Date.now() - startedAt,
  };
}
