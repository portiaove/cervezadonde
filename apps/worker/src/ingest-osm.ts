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

async function upsertEnrichment(sql: Sql, p: OsmPlace): Promise<void> {
  await sql`
    INSERT INTO store_osm_enrichment (
      osm_id, osm_type, geom, name_osm, address_osm,
      opening_hours_raw, shop_tag, amenity_tag, tags, last_fetched_at, updated_at
    ) VALUES (
      ${p.osmId}, ${p.osmType},
      ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326),
      ${p.name}, ${p.address}, ${p.openingHours}, ${p.shopTag}, ${p.amenityTag},
      ${sql.json(p.tags)}, now(), now()
    )
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

async function findCandidates(sql: Sql, p: OsmPlace): Promise<StoreCandidate[]> {
  return sql<StoreCandidate[]>`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography AS g
    )
    SELECT
      s.id                                              AS "storeId",
      s.normalized_name                                 AS "normalizedName",
      ST_Distance(s.geom::geography, origin.g)::float8  AS "distanceM"
    FROM stores s, origin
    WHERE s.confidence_level <> 'excluded'
      AND ST_DWithin(s.geom::geography, origin.g, ${MATCH_RADIUS_M})
    ORDER BY s.geom::geography <-> origin.g
    LIMIT 10
  `;
}

async function applyMatch(
  sql: Sql,
  p: OsmPlace,
  storeId: number,
  matchedBy: string,
  distanceM: number,
  score: number,
): Promise<void> {
  await sql`
    UPDATE store_osm_enrichment SET
      store_id = ${storeId},
      matched_by = ${matchedBy},
      match_distance_m = ${distanceM},
      match_score = ${score},
      updated_at = now()
    WHERE osm_id = ${p.osmId} AND osm_type = ${p.osmType}
  `;
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
    let i = 0;
    for (const p of places) {
      await upsertEnrichment(sql, p);
      enrichmentUpserted += 1;

      const candidates = await findCandidates(sql, p);
      const match = selectMatch(p, candidates);
      if (match) {
        await applyMatch(sql, p, match.storeId, match.matchedBy, match.distanceM, match.score);
        if (match.matchedBy === 'both') matchedBoth += 1;
        else matchedSpatial += 1;
      } else {
        unmatched += 1;
      }

      i += 1;
      if (i % 1000 === 0) log(`  processed ${i}/${places.length}`);
    }

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
