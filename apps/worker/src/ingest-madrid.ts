import { createReadStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSql, type Sql } from '@minimarket/db';
import { downloadIfNeeded } from './download.js';
import {
  MADRID_ACTIVIDADES_COLUMNS,
  MADRID_CSV_DELIMITER,
  MADRID_COORDS_SRID,
  MADRID_SOURCE_NAME,
  SITUACION,
  TIPO_ACCESO,
  getCacheDir,
  getMadridUrls,
} from './sources/madrid.js';
import { TARGET_EPIGRAPH_CODES_V2, isTargetEpigraphV2 } from './scoring/epigraphs.js';
import { scoreCandidate } from './scoring/v2.js';

const MADRID_BBOX = {
  xMin: 420000,
  xMax: 470000,
  yMin: 4460000,
  yMax: 4495000,
};

export type IngestMadridSummary = {
  importRunId: number;
  fileHash: string;
  stagedRows: number;
  candidatesTotal: number;
  upserted: number;
  inserted: number;
  updated: number;
  excluded: number;
  high: number;
  medium: number;
  low: number;
  deactivated: number;
  durationMs: number;
};

type AggregatedCandidate = {
  id_local: string;
  rotulo: string | null;
  district: string | null;
  neighbourhood: string | null;
  postal_code: string | null;
  address: string | null;
  x: number;
  y: number;
  situacion: string | null;
  epigraph_codes: string[];
  epigraph_descs: string[] | null;
};

const normalizeForDb = (s: string | null): string => {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
};

/**
 * Strip a UTF-8 BOM from the very first chunk if present. Postgres COPY does
 * not handle BOM and would treat it as part of the first header byte.
 */
const bomStripper = (): Transform => {
  let firstChunkSeen = false;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        if (
          chunk.length >= 3 &&
          chunk[0] === 0xef &&
          chunk[1] === 0xbb &&
          chunk[2] === 0xbf
        ) {
          cb(null, chunk.subarray(3));
          return;
        }
      }
      cb(null, chunk);
    },
  });
};

async function copyIntoStaging(
  sql: Sql,
  csvPath: string,
  log: (m: string) => void,
): Promise<number> {
  log('TRUNCATE staging_madrid_actividades');
  await sql`TRUNCATE staging_madrid_actividades RESTART IDENTITY`;

  const columns = MADRID_ACTIVIDADES_COLUMNS.join(', ');
  const copySql = `COPY staging_madrid_actividades (
      ${columns}
    ) FROM STDIN WITH (FORMAT csv, DELIMITER '${MADRID_CSV_DELIMITER}', HEADER true, QUOTE '"', NULL '', ENCODING 'UTF8')`;

  log('COPY FROM STDIN — streaming CSV into staging');
  const writable = await sql.unsafe(copySql).writable();
  await pipeline(createReadStream(csvPath), bomStripper(), writable);

  const [count] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM staging_madrid_actividades
  `;
  return count?.n ?? 0;
}

async function aggregateCandidates(
  sql: Sql,
  limit: number | null,
  log: (m: string) => void,
): Promise<AggregatedCandidate[]> {
  log('aggregating candidates (per id_local, V2 target-epigraph filter — incl. 561xxx bars)');
  const targetCodes = [...TARGET_EPIGRAPH_CODES_V2];

  const rows = await sql<AggregatedCandidate[]>`
    WITH typed AS (
      SELECT
        id_local,
        rotulo,
        desc_distrito_local,
        desc_barrio_local,
        clase_vial_edificio,
        desc_vial_edificio,
        num_edificio,
        cal_edificio,
        desc_situacion_local,
        id_epigrafe,
        desc_epigrafe,
        CASE
          WHEN coordenada_x_local ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN coordenada_x_local::float8
          ELSE NULL
        END AS x,
        CASE
          WHEN coordenada_y_local ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN coordenada_y_local::float8
          ELSE NULL
        END AS y
      FROM staging_madrid_actividades
      WHERE id_tipo_acceso_local = ${TIPO_ACCESO.PUERTA_CALLE}
        AND id_situacion_local = ${SITUACION.ABIERTO}
        AND id_local IS NOT NULL
        AND id_local <> ''
    ),
    filtered AS (
      SELECT * FROM typed
      WHERE x BETWEEN ${MADRID_BBOX.xMin} AND ${MADRID_BBOX.xMax}
        AND y BETWEEN ${MADRID_BBOX.yMin} AND ${MADRID_BBOX.yMax}
    ),
    agg AS (
      SELECT
        id_local,
        MAX(rotulo)                                              AS rotulo,
        MAX(desc_distrito_local)                                 AS district,
        MAX(desc_barrio_local)                                   AS neighbourhood,
        NULL::text                                               AS postal_code,
        MAX(
          trim(
            concat_ws(' ',
              NULLIF(clase_vial_edificio, ''),
              NULLIF(desc_vial_edificio, ''),
              NULLIF(num_edificio, ''),
              NULLIF(cal_edificio, '')
            )
          )
        )                                                        AS address,
        MAX(x)                                                   AS x,
        MAX(y)                                                   AS y,
        MAX(desc_situacion_local)                                AS situacion,
        array_agg(DISTINCT id_epigrafe) FILTER (
          WHERE id_epigrafe IS NOT NULL AND id_epigrafe <> ''
        )                                                        AS epigraph_codes,
        array_agg(DISTINCT desc_epigrafe) FILTER (
          WHERE desc_epigrafe IS NOT NULL AND desc_epigrafe <> ''
        )                                                        AS epigraph_descs
      FROM filtered
      GROUP BY id_local
    )
    SELECT *
    FROM agg
    WHERE epigraph_codes IS NOT NULL
      AND epigraph_codes && ${sql.array(targetCodes)}::text[]
    ORDER BY id_local
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

  log(`aggregated ${rows.length} target candidates`);
  return rows;
}

async function loadChainPatterns(sql: Sql): Promise<string[]> {
  const rows = await sql<{ pattern: string }[]>`
    SELECT pattern FROM chain_patterns WHERE enabled = TRUE
  `;
  return rows.map((r) => r.pattern);
}

async function upsertCandidate(
  sql: Sql,
  c: AggregatedCandidate,
  importRunId: number,
  chainPatterns: string[],
): Promise<{ inserted: boolean; level: string }> {
  const scored = scoreCandidate({
    name: c.rotulo ?? '',
    epigraphCodes: c.epigraph_codes,
    officialStatus: c.situacion,
    openingHoursOsm: null,
    chainPatterns,
  });

  const result = await sql<{ id: number; xmax: string }[]>`
    INSERT INTO stores (
      source_local_id, source_name, name, normalized_name,
      address, postal_code, district, neighbourhood,
      geom,
      place_type, sells_takeaway_beer, sells_onsite_beer,
      primary_category, badges, confidence_score, confidence_level,
      scoring_version, is_chain, official_status,
      last_seen_in_official_source_at, last_import_run_id
    ) VALUES (
      ${c.id_local}, ${MADRID_SOURCE_NAME}, ${c.rotulo ?? ''}, ${normalizeForDb(c.rotulo)},
      ${c.address || null}, ${c.postal_code}, ${c.district || null}, ${c.neighbourhood || null},
      ST_Transform(ST_SetSRID(ST_MakePoint(${c.x}, ${c.y}), ${MADRID_COORDS_SRID}), 4326),
      ${scored.placeType}, ${scored.sellsTakeawayBeer}, ${scored.sellsOnsiteBeer},
      NULL, ${scored.badges}, ${scored.score}, ${scored.level},
      ${scored.scoringVersion}, ${scored.isChain}, ${c.situacion},
      now(), ${importRunId}
    )
    ON CONFLICT (source_name, source_local_id) DO UPDATE SET
      name = EXCLUDED.name,
      normalized_name = EXCLUDED.normalized_name,
      address = EXCLUDED.address,
      postal_code = EXCLUDED.postal_code,
      district = EXCLUDED.district,
      neighbourhood = EXCLUDED.neighbourhood,
      geom = EXCLUDED.geom,
      place_type = EXCLUDED.place_type,
      sells_takeaway_beer = EXCLUDED.sells_takeaway_beer,
      sells_onsite_beer = EXCLUDED.sells_onsite_beer,
      primary_category = EXCLUDED.primary_category,
      badges = EXCLUDED.badges,
      confidence_score = EXCLUDED.confidence_score,
      confidence_level = EXCLUDED.confidence_level,
      scoring_version = EXCLUDED.scoring_version,
      is_chain = EXCLUDED.is_chain,
      official_status = EXCLUDED.official_status,
      last_seen_in_official_source_at = now(),
      last_import_run_id = EXCLUDED.last_import_run_id,
      updated_at = now()
    RETURNING id, xmax::text
  `;
  const row = result[0];
  if (!row) throw new Error(`upsert returned no row for id_local=${c.id_local}`);
  const inserted = row.xmax === '0';

  // Replace activity rows for this store (small set per local, cheap).
  await sql`DELETE FROM store_activities WHERE store_id = ${row.id}`;
  if (c.epigraph_codes.length > 0) {
    const activityRows = c.epigraph_codes.map((code, idx) => ({
      store_id: row.id,
      epigraph_code: code,
      epigraph_description: c.epigraph_descs?.[idx] ?? null,
      is_target_epigraph: isTargetEpigraphV2(code),
    }));
    await sql`
      INSERT INTO store_activities ${sql(activityRows, 'store_id', 'epigraph_code', 'epigraph_description', 'is_target_epigraph')}
    `;
  }

  return { inserted, level: scored.level };
}

async function softDeactivateMissing(
  sql: Sql,
  importRunId: number,
): Promise<number> {
  const result = await sql<{ count: number }[]>`
    WITH updated AS (
      UPDATE stores
      SET
        badges = CASE
          WHEN 'posible_cerrado' = ANY(badges) THEN badges
          ELSE array_append(badges, 'posible_cerrado')
        END,
        confidence_level = 'excluded',
        updated_at = now()
      WHERE source_name = ${MADRID_SOURCE_NAME}
        AND (last_import_run_id IS NULL OR last_import_run_id <> ${importRunId})
        AND NOT ('posible_cerrado' = ANY(badges))
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `;
  return result[0]?.count ?? 0;
}

export async function ingestMadrid(opts: {
  limit?: number;
  fresh?: boolean;
  log?: (m: string) => void;
}): Promise<IngestMadridSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const sql = getSql();
  const startedAt = Date.now();
  const { actividades: url } = getMadridUrls();

  // If --fresh was requested, ignore the cache. We do that by writing to a temp name first.
  const fileName = 'madrid-actividades.csv';
  if (opts.fresh) {
    const { unlink } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const cached = resolve(process.cwd(), getCacheDir(), fileName);
    try {
      await unlink(cached);
      log(`removed cache: ${cached}`);
    } catch {
      // not present — fine
    }
  }

  const dl = await downloadIfNeeded({
    url,
    destDir: getCacheDir(),
    fileName,
    log,
  });

  log(`source file: ${dl.path} (${dl.fromCache ? 'cache' : 'downloaded'}, ${(dl.size / 1024 / 1024).toFixed(1)} MB)`);

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (source_name, source_url, status, file_hash)
    VALUES (${MADRID_SOURCE_NAME}, ${url}, 'running', ${dl.hash})
    RETURNING id
  `;
  if (!run) throw new Error('failed to create import_run');
  const importRunId = run.id;
  log(`import_run id=${importRunId}`);

  let stagedRows = 0;
  let upserted = 0;
  let inserted = 0;
  let updated = 0;
  let excluded = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let candidatesTotal = 0;
  let deactivated = 0;

  try {
    stagedRows = await copyIntoStaging(sql, dl.path, log);
    log(`staged ${stagedRows.toLocaleString('es-ES')} rows`);

    const candidates = await aggregateCandidates(sql, opts.limit ?? null, log);
    candidatesTotal = candidates.length;

    const chainPatterns = await loadChainPatterns(sql);
    log(`scoring + upserting ${candidates.length} candidates...`);

    let i = 0;
    for (const c of candidates) {
      const { inserted: wasInserted, level } = await upsertCandidate(
        sql,
        c,
        importRunId,
        chainPatterns,
      );
      upserted += 1;
      if (wasInserted) inserted += 1;
      else updated += 1;
      if (level === 'high') high += 1;
      else if (level === 'medium') medium += 1;
      else if (level === 'low') low += 1;
      else excluded += 1;

      i += 1;
      if (i % 500 === 0) log(`  upserted ${i}/${candidates.length}`);
    }

    deactivated = await softDeactivateMissing(sql, importRunId);
    log(`soft-deactivated ${deactivated} previously-seen stores`);

    await sql`
      UPDATE import_runs SET
        status = 'succeeded',
        finished_at = now(),
        row_count = ${stagedRows},
        inserted_count = ${inserted},
        updated_count = ${updated},
        deactivated_count = ${deactivated}
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

  const durationMs = Date.now() - startedAt;
  return {
    importRunId,
    fileHash: dl.hash,
    stagedRows,
    candidatesTotal,
    upserted,
    inserted,
    updated,
    excluded,
    high,
    medium,
    low,
    deactivated,
    durationMs,
  };
}
