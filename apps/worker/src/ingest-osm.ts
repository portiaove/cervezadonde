import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Sql, getSql } from '@cervezadonde/db';
import { getCacheDir } from './sources/madrid.js';
import {
  OSM_SOURCE_NAME,
  type OsmPlace,
  type StoreCandidate,
  buildOverpassQuery,
  getOverpassConfig,
  parseOverpass,
  selectMatch,
} from './sources/osm.js';

/** Spatial radius for matching an OSM place to a Censo store (ADR-005). */
const MATCH_RADIUS_M = 25;

export type IngestOsmSummary = {
  importRunId: number;
  fileHash: string;
  fromCache: boolean;
  elementsFetched: number;
  placesParsed: number;
  placesWithHours: number;
  enrichmentUpserted: number;
  matchedBoth: number;
  matchedSpatial: number;
  unmatched: number;
  storesEnriched: number;
  durationMs: number;
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const todayStamp = (): string => new Date().toISOString().slice(0, 10);

/**
 * Fetch the Overpass response, caching the raw JSON to
 * `data/raw/osm-madrid-{date}.json`. Re-uses today's cache unless `fresh`.
 */
async function fetchOverpassCached(opts: {
  url: string;
  query: string;
  fresh: boolean;
  log: (m: string) => void;
}): Promise<{ text: string; hash: string; fromCache: boolean; path: string }> {
  const destDir = resolve(process.cwd(), getCacheDir());
  const dest = join(destDir, `osm-madrid-${todayStamp()}.json`);
  await mkdir(destDir, { recursive: true });

  if (!opts.fresh && (await fileExists(dest))) {
    const text = await readFile(dest, 'utf-8');
    const hash = createHash('sha256').update(text).digest('hex');
    opts.log(`cache hit: ${dest} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
    return { text, hash, fromCache: true, path: dest };
  }

  opts.log(`querying Overpass: ${opts.url}`);
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      // Overpass requires a descriptive User-Agent identifying the client.
      'User-Agent':
        'cervezadonde.es/0.1 (OSM opening-hours enrichment; contact via github.com/portiaove/cervezadonde)',
    },
    body: `data=${encodeURIComponent(opts.query)}`,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Overpass failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  // Overpass returns HTML/text on rate-limit or error even with 200 sometimes.
  if (!text.trimStart().startsWith('{')) {
    throw new Error(`Overpass did not return JSON (rate-limited?): ${text.slice(0, 200)}`);
  }
  await writeFile(dest, text, 'utf-8');
  const hash = createHash('sha256').update(text).digest('hex');
  opts.log(`fetched + cached ${dest} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
  return { text, hash, fromCache: false, path: dest };
}

/** Max rows per bulk statement — keeps array parameters a sane size. */
const CHUNK = 2000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type CandidatePair = StoreCandidate & { osmId: number; osmType: string };

type MatchRow = {
  osmId: number;
  osmType: string;
  storeId: number;
  matchedBy: string;
  dist: number;
  score: number;
};

/** Bulk upsert parsed OSM places into store_osm_enrichment (one stmt/chunk). */
async function bulkUpsertEnrichment(sql: Sql, places: OsmPlace[]): Promise<void> {
  for (const part of chunk(places, CHUNK)) {
    const ids = part.map((p) => p.osmId);
    const types = part.map((p) => p.osmType);
    const lons = part.map((p) => p.lon);
    const lats = part.map((p) => p.lat);
    const names = part.map((p) => p.name);
    const addrs = part.map((p) => p.address);
    const hours = part.map((p) => p.openingHours);
    const shops = part.map((p) => p.shopTag);
    const amenities = part.map((p) => p.amenityTag);
    const tags = part.map((p) => JSON.stringify(p.tags));
    await sql`
      INSERT INTO store_osm_enrichment (
        osm_id, osm_type, geom, name_osm, address_osm,
        opening_hours_raw, shop_tag, amenity_tag, tags, last_fetched_at, updated_at
      )
      SELECT
        t.osm_id, t.osm_type,
        ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326),
        t.name_osm, t.address_osm, t.opening_hours_raw, t.shop_tag, t.amenity_tag,
        t.tags::jsonb, now(), now()
      FROM unnest(
        ${ids}::bigint[], ${types}::text[], ${lons}::float8[], ${lats}::float8[],
        ${names}::text[], ${addrs}::text[], ${hours}::text[], ${shops}::text[],
        ${amenities}::text[], ${tags}::text[]
      ) AS t(osm_id, osm_type, lon, lat, name_osm, address_osm,
             opening_hours_raw, shop_tag, amenity_tag, tags)
      ON CONFLICT (osm_id, osm_type) DO UPDATE SET
        geom = EXCLUDED.geom,
        name_osm = EXCLUDED.name_osm,
        address_osm = EXCLUDED.address_osm,
        opening_hours_raw = EXCLUDED.opening_hours_raw,
        shop_tag = EXCLUDED.shop_tag,
        amenity_tag = EXCLUDED.amenity_tag,
        tags = EXCLUDED.tags,
        last_fetched_at = now(),
        updated_at = now()
    `;
  }
}

/**
 * For every enrichment row touched this run, fetch up to 5 candidate stores
 * within the match radius — one set-based query with a spatial LATERAL join
 * (uses the stores_geog_gix functional index). Name scoring happens in JS.
 */
async function fetchCandidatePairs(sql: Sql, runStart: Date): Promise<CandidatePair[]> {
  return sql<CandidatePair[]>`
    SELECT
      e.osm_id            AS "osmId",
      e.osm_type          AS "osmType",
      c.store_id          AS "storeId",
      c.normalized_name   AS "normalizedName",
      c.dist              AS "distanceM"
    FROM store_osm_enrichment e
    CROSS JOIN LATERAL (
      SELECT
        s.id                                              AS store_id,
        s.normalized_name                                 AS normalized_name,
        ST_Distance(s.geom::geography, e.geom::geography)::float8 AS dist
      FROM stores s
      WHERE s.confidence_level <> 'excluded'
        AND ST_DWithin(s.geom::geography, e.geom::geography, ${MATCH_RADIUS_M})
      ORDER BY s.geom::geography <-> e.geom::geography
      LIMIT 5
    ) c
    WHERE e.last_fetched_at >= ${runStart}
  `;
}

/** Bulk write match results back onto store_osm_enrichment (one stmt/chunk). */
async function bulkApplyMatches(sql: Sql, matches: MatchRow[]): Promise<void> {
  for (const part of chunk(matches, CHUNK)) {
    const osmIds = part.map((m) => m.osmId);
    const osmTypes = part.map((m) => m.osmType);
    const storeIds = part.map((m) => m.storeId);
    const matchedBys = part.map((m) => m.matchedBy);
    const dists = part.map((m) => m.dist);
    const scores = part.map((m) => m.score);
    await sql`
      UPDATE store_osm_enrichment t SET
        store_id = u.store_id,
        matched_by = u.matched_by,
        match_distance_m = u.dist,
        match_score = u.score,
        updated_at = now()
      FROM unnest(
        ${osmIds}::bigint[], ${osmTypes}::text[], ${storeIds}::bigint[],
        ${matchedBys}::text[], ${dists}::float8[], ${scores}::float8[]
      ) AS u(osm_id, osm_type, store_id, matched_by, dist, score)
      WHERE t.osm_id = u.osm_id AND t.osm_type = u.osm_type
    `;
  }
}

/**
 * Materialise the best available OSM opening_hours onto matched stores.
 * When a store matched several OSM elements, the highest match_score with a
 * non-null opening_hours wins. Only touches rows enriched in this run.
 */
async function materialiseHours(sql: Sql, runStart: Date): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    WITH ranked AS (
      SELECT DISTINCT ON (store_id)
        store_id, opening_hours_raw
      FROM store_osm_enrichment
      WHERE store_id IS NOT NULL
        AND opening_hours_raw IS NOT NULL
        AND last_fetched_at >= ${runStart}
      ORDER BY store_id, match_score DESC NULLS LAST, updated_at DESC
    ),
    updated AS (
      UPDATE stores s SET
        opening_hours_osm = r.opening_hours_raw,
        last_seen_osm_at = now(),
        updated_at = now()
      FROM ranked r
      WHERE s.id = r.store_id
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `;
  return rows[0]?.count ?? 0;
}

export async function ingestOsm(opts: {
  fresh?: boolean;
  limit?: number;
  log?: (m: string) => void;
}): Promise<IngestOsmSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const sql = getSql();
  const startedAt = Date.now();
  const runStart = new Date();

  const cfg = getOverpassConfig();
  const query = buildOverpassQuery(cfg);
  log(`Overpass bbox: [${cfg.bbox.join(', ')}]`);

  const dl = await fetchOverpassCached({
    url: cfg.url,
    query,
    fresh: opts.fresh ?? false,
    log,
  });

  const parsed = parseOverpass(JSON.parse(dl.text));
  const elementsFetched = (JSON.parse(dl.text).elements ?? []).length;
  const places = opts.limit ? parsed.slice(0, opts.limit) : parsed;
  const placesWithHours = places.filter((p) => p.openingHours).length;
  log(
    `parsed ${places.length} places (${placesWithHours} with opening_hours) from ${elementsFetched} elements`,
  );

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (source_name, source_url, status, file_hash)
    VALUES (${OSM_SOURCE_NAME}, ${cfg.url}, 'running', ${dl.hash})
    RETURNING id
  `;
  if (!run) throw new Error('failed to create import_run');
  const importRunId = run.id;
  log(`import_run id=${importRunId}`);

  let enrichmentUpserted = 0;
  let matchedBoth = 0;
  let matchedSpatial = 0;
  let unmatched = 0;
  let storesEnriched = 0;

  try {
    await bulkUpsertEnrichment(sql, places);
    enrichmentUpserted = places.length;
    log(`upserted ${enrichmentUpserted} enrichment rows`);

    const pairs = await fetchCandidatePairs(sql, runStart);
    log(`fetched ${pairs.length} candidate pairs within ${MATCH_RADIUS_M} m`);

    // Group candidate stores by their OSM element, then run the (tested,
    // token-set) matcher in memory.
    const byElement = new Map<string, StoreCandidate[]>();
    for (const r of pairs) {
      const key = `${r.osmType}:${r.osmId}`;
      const cand: StoreCandidate = {
        storeId: r.storeId,
        normalizedName: r.normalizedName,
        distanceM: r.distanceM,
      };
      const list = byElement.get(key);
      if (list) list.push(cand);
      else byElement.set(key, [cand]);
    }

    const matches: MatchRow[] = [];
    for (const p of places) {
      const cands = byElement.get(`${p.osmType}:${p.osmId}`) ?? [];
      const m = selectMatch(p, cands);
      if (!m) {
        unmatched += 1;
        continue;
      }
      matches.push({
        osmId: p.osmId,
        osmType: p.osmType,
        storeId: m.storeId,
        matchedBy: m.matchedBy,
        dist: m.distanceM,
        score: m.score,
      });
      if (m.matchedBy === 'both') matchedBoth += 1;
      else matchedSpatial += 1;
    }
    await bulkApplyMatches(sql, matches);
    log(`matched ${matchedBoth} both + ${matchedSpatial} spatial; ${unmatched} unmatched`);

    storesEnriched = await materialiseHours(sql, runStart);
    log(`materialised opening_hours onto ${storesEnriched} stores`);

    await sql`
      UPDATE import_runs SET
        status = 'succeeded',
        finished_at = now(),
        row_count = ${elementsFetched},
        inserted_count = ${enrichmentUpserted},
        updated_count = ${matchedBoth + matchedSpatial}
      WHERE id = ${importRunId}
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE import_runs SET
        status = 'failed', finished_at = now(), error_message = ${message}
      WHERE id = ${importRunId}
    `;
    throw err;
  }

  return {
    importRunId,
    fileHash: dl.hash,
    fromCache: dl.fromCache,
    elementsFetched,
    placesParsed: places.length,
    placesWithHours,
    enrichmentUpserted,
    matchedBoth,
    matchedSpatial,
    unmatched,
    storesEnriched,
    durationMs: Date.now() - startedAt,
  };
}
