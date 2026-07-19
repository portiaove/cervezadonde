import { createReadStream } from 'node:fs';
import { type Sql, getSql } from '@cervezadonde/db';
import { parse } from 'csv-parse';
import { downloadIfNeeded } from './download.js';
import {
  DIBA_CSV_FILE,
  DIBA_CSV_URL,
  DIBA_SCORING_VERSION,
  DIBA_SOURCE_NAME,
  type DibaRow,
  classifyDibaPremise,
  dibaDisplayName,
  dibaMunicipi,
} from './sources/diba.js';
import { getCacheDir } from './sources/madrid.js';

export type IngestDibaSummary = {
  importRunId: number;
  fileHash: string;
  rowsTotal: number;
  candidates: number;
  skippedNoCoords: number;
  byType: Record<string, number>;
  upserted: number;
  deactivated: number;
  durationMs: number;
};

/** Same normalisation the other censo adapters apply before writing names. */
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

type Candidate = {
  slid: string;
  name: string;
  nname: string;
  address: string | null;
  district: string | null;
  lon: number;
  lat: number;
  placeType: string;
  onsite: boolean;
  takeaway: boolean;
  score: number;
  level: string;
  isChain: boolean;
};

async function loadChainPatterns(sql: Sql): Promise<string[]> {
  const rows = await sql<{ pattern: string }[]>`
    SELECT pattern FROM chain_patterns WHERE enabled = TRUE
  `;
  return rows.map((r) => r.pattern);
}

// Barcelona province + margin (guards against broken geocoding in the source).
const CAT_BBOX = { latMin: 40.0, latMax: 42.5, lonMin: 0.3, lonMax: 3.2 };

const BATCH_SIZE = 1000;

async function upsertBatch(sql: Sql, batch: Candidate[], importRunId: number): Promise<void> {
  await sql`
    INSERT INTO stores (
      source_local_id, source_name, name, normalized_name, address,
      district, geom,
      place_type, sells_onsite_beer, sells_takeaway_beer,
      badges, confidence_score, confidence_level, scoring_version,
      is_chain, last_seen_in_official_source_at, last_import_run_id
    )
    SELECT
      t.slid, ${DIBA_SOURCE_NAME}, t.name, t.nname, t.addr,
      t.district, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326),
      t.ptype::place_type, (t.onsite = 1), (t.takeaway = 1),
      -- Badge set is fully derivable; GIA has no opening hours, so
      -- horario_no_confirmado always applies.
      array_remove(ARRAY[
        t.ptype,
        CASE WHEN t.takeaway = 1 THEN 'vende_cerveza_para_llevar' END,
        CASE WHEN t.onsite = 1 THEN 'vende_cerveza_in_situ' END,
        'horario_no_confirmado'
      ], NULL),
      t.score, t.level::confidence_level, ${DIBA_SCORING_VERSION},
      (t.chain = 1), now(), ${importRunId}
    FROM unnest(
      ${batch.map((c) => c.slid)}::text[],
      ${batch.map((c) => c.name)}::text[],
      ${batch.map((c) => c.nname)}::text[],
      ${batch.map((c) => c.address)}::text[],
      ${batch.map((c) => c.district)}::text[],
      ${batch.map((c) => c.lon)}::float8[],
      ${batch.map((c) => c.lat)}::float8[],
      ${batch.map((c) => c.placeType)}::text[],
      ${batch.map((c) => (c.onsite ? 1 : 0))}::int[],
      ${batch.map((c) => (c.takeaway ? 1 : 0))}::int[],
      ${batch.map((c) => c.score)}::int[],
      ${batch.map((c) => c.level)}::text[],
      ${batch.map((c) => (c.isChain ? 1 : 0))}::int[]
    ) AS t(slid, name, nname, addr, district, lon, lat, ptype, onsite, takeaway, score, level, chain)
    ON CONFLICT (source_name, source_local_id) DO UPDATE SET
      name = EXCLUDED.name,
      normalized_name = EXCLUDED.normalized_name,
      address = EXCLUDED.address,
      district = EXCLUDED.district,
      geom = EXCLUDED.geom,
      place_type = EXCLUDED.place_type,
      sells_onsite_beer = EXCLUDED.sells_onsite_beer,
      sells_takeaway_beer = EXCLUDED.sells_takeaway_beer,
      badges = EXCLUDED.badges,
      confidence_score = EXCLUDED.confidence_score,
      -- Fresh scoring reactivates rows a previous enrichment excluded; the
      -- enrich step then re-excludes them deterministically.
      confidence_level = EXCLUDED.confidence_level,
      scoring_version = EXCLUDED.scoring_version,
      is_chain = EXCLUDED.is_chain,
      last_seen_in_official_source_at = now(),
      last_import_run_id = EXCLUDED.last_import_run_id,
      updated_at = now()
  `;
}

/**
 * Hide rows no longer present in the source. GIA refreshes daily, so a premise
 * dropping out is a strong "closed" signal (marked posible_cerrado + excluded).
 */
async function softDeactivateMissing(sql: Sql, importRunId: number): Promise<number> {
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
      WHERE source_name = ${DIBA_SOURCE_NAME}
        AND (last_import_run_id IS NULL OR last_import_run_id <> ${importRunId})
        AND NOT ('posible_cerrado' = ANY(badges))
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `;
  return result[0]?.count ?? 0;
}

/**
 * Ingest the Barcelona-province GIA census as censo_diba. Streams the Socrata
 * CSV, keeps only beer-relevant activities (see sources/diba.ts), classifies by
 * free-text and bulk-upserts. The OSM enrichment step (ingest-osm-canonical)
 * then merges these onto matched OSM stores exactly as it does for the other
 * censos (it matches any source named censo_%).
 */
export async function ingestDiba(opts: {
  fresh?: boolean;
  log?: (msg: string) => void;
}): Promise<IngestDibaSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const sql = getSql();
  const startedAt = Date.now();

  if (opts.fresh) {
    const { unlink } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await unlink(resolve(process.cwd(), getCacheDir(), DIBA_CSV_FILE)).catch(() => undefined);
  }

  const dl = await downloadIfNeeded({
    url: DIBA_CSV_URL,
    destDir: getCacheDir(),
    fileName: DIBA_CSV_FILE,
    log,
  });
  log(
    `source file: ${dl.path} (${dl.fromCache ? 'cache' : 'downloaded'}, ${(dl.size / 1024 / 1024).toFixed(1)} MB)`,
  );

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (source_name, source_url, status, file_hash)
    VALUES (${DIBA_SOURCE_NAME}, ${DIBA_CSV_URL}, 'running', ${dl.hash})
    RETURNING id
  `;
  if (!run) throw new Error('failed to create import_run');
  const importRunId = run.id;
  log(`import_run id=${importRunId}`);

  let rowsTotal = 0;
  let skippedNoCoords = 0;
  let upserted = 0;
  let deactivated = 0;
  const byType: Record<string, number> = {};

  try {
    const chainPatterns = await loadChainPatterns(sql);

    const parser = createReadStream(dl.path).pipe(
      parse({ columns: true, bom: true, skip_empty_lines: true }),
    );

    let batch: Candidate[] = [];
    for await (const record of parser) {
      const row = record as DibaRow;
      rowsTotal += 1;

      const classified = classifyDibaPremise({
        descripcio: row.descripcio_activitat ?? '',
        name: row.nom_comercial ?? '',
        chainPatterns,
      });
      if (!classified) continue;

      const lat = Number.parseFloat(row.latitud);
      const lon = Number.parseFloat(row.longitud);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < CAT_BBOX.latMin ||
        lat > CAT_BBOX.latMax ||
        lon < CAT_BBOX.lonMin ||
        lon > CAT_BBOX.lonMax
      ) {
        skippedNoCoords += 1;
        continue;
      }

      const name = dibaDisplayName(row);
      byType[classified.placeType] = (byType[classified.placeType] ?? 0) + 1;
      batch.push({
        slid: `${row.codi_ens}-${row.identificador}`,
        name,
        nname: normalizeForDb(name),
        address: row.adreca_complerta?.trim() || null,
        district: dibaMunicipi(row),
        lon,
        lat,
        placeType: classified.placeType,
        onsite: classified.sellsOnsiteBeer,
        takeaway: classified.sellsTakeawayBeer,
        score: classified.score,
        level: classified.level,
        isChain: classified.isChain,
      });

      if (batch.length >= BATCH_SIZE) {
        await upsertBatch(sql, batch, importRunId);
        upserted += batch.length;
        log(`  upserted ${upserted}`);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await upsertBatch(sql, batch, importRunId);
      upserted += batch.length;
    }

    deactivated = await softDeactivateMissing(sql, importRunId);
    log(`soft-deactivated ${deactivated} previously-seen stores`);

    await sql`
      UPDATE import_runs SET
        status = 'succeeded',
        finished_at = now(),
        row_count = ${rowsTotal},
        inserted_count = ${upserted},
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

  return {
    importRunId,
    fileHash: dl.hash,
    rowsTotal,
    candidates: upserted,
    skippedNoCoords,
    byType,
    upserted,
    deactivated,
    durationMs: Date.now() - startedAt,
  };
}
