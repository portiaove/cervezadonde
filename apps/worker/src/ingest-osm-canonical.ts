// OSM-canonical store ingest (ADR-007). Unlike ingest-osm.ts (which only adds
// opening_hours onto existing Censo stores), this makes OSM the canonical
// source: every bar/shop OSM POI in a region becomes a `stores` row under
// source_name='osm'. A follow-up step flags OSM stores confirmed by the Madrid
// Censo as `oficial` and drops the now-duplicated Censo rows.
//
// Prototype: reuses Overpass with a region bbox. Full Spain will switch to a
// Geofabrik pbf + osmium (see ADR-007).
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Sql, getSql } from '@cervezadonde/db';
import { getCacheDir } from './sources/madrid.js';
import {
  OSM_SOURCE_NAME,
  type OsmPlace,
  buildOverpassQuery,
  classifyOsmPlace,
  getOverpassConfig,
  normalizeName,
  parseOverpass,
} from './sources/osm.js';

/** Region bboxes [south, west, north, east]. */
export const REGIONS: Record<string, [number, number, number, number]> = {
  'comunidad-madrid': [39.88, -4.58, 41.17, -3.05],
  'madrid-centro': [40.4, -3.72, 40.44, -3.68],
};

/** Match radius for confirming an OSM store against a Censo record. */
const CONFIRM_RADIUS_M = 30;
const CHUNK = 2000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type IngestOsmCanonicalSummary = {
  importRunId: number;
  region: string;
  elementsFetched: number;
  placesParsed: number;
  withHours: number;
  upserted: number;
  byType: Record<string, number>;
  officialFlagged: number;
  censoExcluded: number;
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

async function fetchOverpass(opts: {
  url: string;
  query: string;
  region: string;
  fresh: boolean;
  log: (m: string) => void;
}): Promise<{ text: string; hash: string }> {
  const dir = resolve(process.cwd(), getCacheDir());
  const dest = join(dir, `osm-${opts.region}-${new Date().toISOString().slice(0, 10)}.json`);
  await mkdir(dir, { recursive: true });
  if (!opts.fresh && (await fileExists(dest))) {
    const text = await readFile(dest, 'utf-8');
    opts.log(`cache hit: ${dest} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
    return { text, hash: createHash('sha256').update(text).digest('hex') };
  }
  opts.log(`querying Overpass for ${opts.region}...`);
  // Overpass 429/504/timeouts are routine on the public instance — retry.
  const MAX_ATTEMPTS = 4;
  let text = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent':
          'cervezadonde.es/0.1 (OSM canonical ingest; contact via github.com/portiaove/cervezadonde)',
      },
      body: `data=${encodeURIComponent(opts.query)}`,
    });
    const payload = await res.text().catch(() => '');
    if (res.ok && payload.trimStart().startsWith('{')) {
      text = payload;
      break;
    }
    const why = res.ok ? 'non-JSON (rate-limited?)' : `HTTP ${res.status}`;
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `Overpass failed after ${MAX_ATTEMPTS} attempts: ${why} ${payload.slice(0, 160)}`,
      );
    }
    const waitMs = attempt * 8000;
    opts.log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed (${why}); retrying in ${waitMs / 1000}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  await writeFile(dest, text, 'utf-8');
  opts.log(`fetched + cached ${dest} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
  return { text, hash: createHash('sha256').update(text).digest('hex') };
}

async function bulkUpsertStores(
  sql: Sql,
  places: OsmPlace[],
  importRunId: number,
): Promise<Record<string, number>> {
  const byType: Record<string, number> = {};
  for (const part of chunk(places, CHUNK)) {
    const slids: string[] = [];
    const names: string[] = [];
    const nnames: string[] = [];
    const addrs: (string | null)[] = [];
    const lons: number[] = [];
    const lats: number[] = [];
    const ptypes: string[] = [];
    const onsites: number[] = [];
    const takeaways: number[] = [];
    const hours: (string | null)[] = [];
    const cscores: number[] = [];
    const clevels: string[] = [];
    const chains: number[] = [];

    for (const p of part) {
      const c = classifyOsmPlace(p);
      byType[c.placeType] = (byType[c.placeType] ?? 0) + 1;
      slids.push(p.sourceLocalId ?? `${p.osmType}/${p.osmId}`);
      names.push(p.name ?? '');
      nnames.push(normalizeName(p.name));
      addrs.push(p.address);
      lons.push(p.lon);
      lats.push(p.lat);
      ptypes.push(c.placeType);
      onsites.push(c.sellsOnsiteBeer ? 1 : 0);
      takeaways.push(c.sellsTakeawayBeer ? 1 : 0);
      hours.push(p.openingHours);
      cscores.push(p.openingHours ? 80 : 55);
      clevels.push(p.openingHours ? 'high' : 'medium');
      chains.push(p.tags.brand || p.tags['brand:wikidata'] ? 1 : 0);
    }

    await sql`
      INSERT INTO stores (
        source_local_id, source_name, name, normalized_name, address,
        geom, place_type, sells_onsite_beer, sells_takeaway_beer,
        opening_hours_osm, badges, confidence_score, confidence_level,
        scoring_version, is_chain, last_import_run_id, last_seen_osm_at
      )
      SELECT
        t.slid, ${OSM_SOURCE_NAME}, t.name, t.nname, t.addr,
        ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326),
        t.ptype::place_type, (t.onsite = 1), (t.takeaway = 1),
        t.hours, ARRAY[]::text[], t.cscore, t.clevel::confidence_level,
        'osm-v1', (t.chain = 1), ${importRunId}, now()
      FROM unnest(
        ${slids}::text[], ${names}::text[], ${nnames}::text[], ${addrs}::text[],
        ${lons}::float8[], ${lats}::float8[], ${ptypes}::text[],
        ${onsites}::int[], ${takeaways}::int[], ${hours}::text[],
        ${cscores}::int[], ${clevels}::text[], ${chains}::int[]
      ) AS t(slid, name, nname, addr, lon, lat, ptype, onsite, takeaway, hours, cscore, clevel, chain)
      ON CONFLICT (source_name, source_local_id) DO UPDATE SET
        name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name,
        address = EXCLUDED.address,
        geom = EXCLUDED.geom,
        place_type = EXCLUDED.place_type,
        sells_onsite_beer = EXCLUDED.sells_onsite_beer,
        sells_takeaway_beer = EXCLUDED.sells_takeaway_beer,
        opening_hours_osm = EXCLUDED.opening_hours_osm,
        confidence_score = EXCLUDED.confidence_score,
        confidence_level = EXCLUDED.confidence_level,
        is_chain = EXCLUDED.is_chain,
        last_import_run_id = EXCLUDED.last_import_run_id,
        last_seen_osm_at = now(),
        updated_at = now()
    `;
  }
  return byType;
}

/**
 * Merge official municipal censos into the OSM canonical stores (ADR-007).
 * Matches ANY source named censo_<city> (Madrid today; Barcelona/Valencia/…
 * as adapters land). For each OSM store, find its nearest active censo record
 * within CONFIRM_RADIUS_M (a GIST-indexed spatial join) and, in one statement:
 *  - copy the censo's official fields (address/district/neighbourhood/status)
 *    onto the OSM store and flag it `oficial`;
 *  - exclude the now-duplicated censo row (data preserved, just hidden).
 * Censo records with no OSM match stay active — they still add places OSM lacks.
 */
async function enrichWithCenso(
  sql: Sql,
): Promise<{ officialFlagged: number; censoExcluded: number }> {
  const [row] = await sql<{ flagged: number; excluded: number }[]>`
    WITH matches AS (
      SELECT
        o.id AS osm_id, c.id AS censo_id,
        c.address AS c_address, c.district AS c_district,
        c.neighbourhood AS c_neighbourhood, c.official_status AS c_official
      FROM stores o
      CROSS JOIN LATERAL (
        -- Nearest censo row REGARDLESS of confidence_level: matching only
        -- active rows makes re-runs non-deterministic — a store's true dupe is
        -- already excluded, so each run would consume the next-nearest censo
        -- neighbour (a different business) and hide it. Matching the physical
        -- nearest keeps the pairing stable, so re-runs re-affirm, not drift.
        SELECT c.id, c.address, c.district, c.neighbourhood, c.official_status
        FROM stores c
        WHERE c.source_name LIKE 'censo_%'
          AND ST_DWithin(c.geom::geography, o.geom::geography, ${CONFIRM_RADIUS_M})
        -- c.id tiebreak: equidistant censo rows (same building) would otherwise
        -- be picked arbitrarily, leaking a few new exclusions on every re-run.
        ORDER BY c.geom::geography <-> o.geom::geography, c.id
        LIMIT 1
      ) c
      WHERE o.source_name = ${OSM_SOURCE_NAME}
    ),
    merged AS (
      UPDATE stores o SET
        address = COALESCE(NULLIF(m.c_address, ''), NULLIF(o.address, '')),
        district = COALESCE(o.district, m.c_district),
        neighbourhood = COALESCE(o.neighbourhood, m.c_neighbourhood),
        official_status = COALESCE(o.official_status, m.c_official),
        badges = CASE WHEN 'oficial' = ANY(o.badges) THEN o.badges
                      ELSE array_append(o.badges, 'oficial') END,
        updated_at = now()
      FROM matches m
      WHERE o.id = m.osm_id
      RETURNING o.id
    ),
    dropped AS (
      UPDATE stores c SET confidence_level = 'excluded', updated_at = now()
      WHERE c.id IN (SELECT censo_id FROM matches)
        AND c.confidence_level <> 'excluded'
      RETURNING c.id
    )
    SELECT
      (SELECT count(*)::int FROM merged)  AS flagged,
      (SELECT count(*)::int FROM dropped) AS excluded
  `;
  return { officialFlagged: row?.flagged ?? 0, censoExcluded: row?.excluded ?? 0 };
}

/**
 * Persist already-parsed OSM places as canonical stores + run the Censo merge,
 * wrapped in an import_run. Shared by the Overpass (region) and Geofabrik/pbf
 * (national) ingest paths.
 */
export async function persistOsmCanonical(
  sql: Sql,
  places: OsmPlace[],
  opts: { sourceUrl: string; fileHash: string; rowCount: number; log: (m: string) => void },
): Promise<{
  importRunId: number;
  byType: Record<string, number>;
  officialFlagged: number;
  censoExcluded: number;
}> {
  const [run] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (source_name, source_url, status, file_hash)
    VALUES (${OSM_SOURCE_NAME}, ${opts.sourceUrl}, 'running', ${opts.fileHash})
    RETURNING id
  `;
  if (!run) throw new Error('failed to create import_run');
  const importRunId = run.id;
  try {
    const byType = await bulkUpsertStores(sql, places, importRunId);
    opts.log(`upserted ${places.length} OSM stores`);
    const { officialFlagged, censoExcluded } = await enrichWithCenso(sql);
    opts.log(
      `Censo enrichment: ${officialFlagged} flagged 'oficial', ${censoExcluded} Censo dupes excluded`,
    );
    await sql`
      UPDATE import_runs SET status = 'succeeded', finished_at = now(),
        row_count = ${opts.rowCount}, inserted_count = ${places.length}, updated_count = ${officialFlagged}
      WHERE id = ${importRunId}
    `;
    return { importRunId, byType, officialFlagged, censoExcluded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE import_runs SET status='failed', finished_at=now(), error_message=${message} WHERE id=${importRunId}`;
    throw err;
  }
}

export async function ingestOsmCanonical(opts: {
  region?: string;
  fresh?: boolean;
  limit?: number;
  log?: (m: string) => void;
}): Promise<IngestOsmCanonicalSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const region = opts.region ?? 'comunidad-madrid';
  const bbox = REGIONS[region];
  if (!bbox)
    throw new Error(`unknown region '${region}'. Known: ${Object.keys(REGIONS).join(', ')}`);

  const sql = getSql();
  const startedAt = Date.now();
  const base = getOverpassConfig();
  const cfg = { ...base, bbox };
  const query = buildOverpassQuery(cfg);
  log(`region ${region} bbox [${bbox.join(', ')}]`);

  const dl = await fetchOverpass({ url: cfg.url, query, region, fresh: opts.fresh ?? false, log });
  const doc = JSON.parse(dl.text);
  const elementsFetched = (doc.elements ?? []).length;
  const parsed = parseOverpass(doc);
  const places = opts.limit ? parsed.slice(0, opts.limit) : parsed;
  const withHours = places.filter((p) => p.openingHours).length;
  log(`parsed ${places.length} places (${withHours} with hours) from ${elementsFetched} elements`);

  const { importRunId, byType, officialFlagged, censoExcluded } = await persistOsmCanonical(
    sql,
    places,
    { sourceUrl: cfg.url, fileHash: dl.hash, rowCount: elementsFetched, log },
  );

  return {
    importRunId,
    region,
    elementsFetched,
    placesParsed: places.length,
    withHours,
    upserted: places.length,
    byType,
    officialFlagged,
    censoExcluded,
    durationMs: Date.now() - startedAt,
  };
}
