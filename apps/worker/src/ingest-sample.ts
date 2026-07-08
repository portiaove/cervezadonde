import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { getSql } from '@cervezadonde/db';
import { isTargetEpigraphV2 } from './scoring/epigraphs.js';
import { scoreCandidate } from './scoring/v2.js';

type FixtureRow = {
  source_local_id: string;
  name: string;
  address: string;
  postal_code: string;
  district: string;
  neighbourhood: string;
  x_25830: string;
  y_25830: string;
  epigraph_code: string;
  epigraph_description: string;
  official_status: string;
};

export type IngestSummary = {
  importRunId: number;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  excludedCount: number;
  highCount: number;
  mediumCount: number;
  fileHash: string;
};

const normalizeName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

async function loadChainPatterns(sql: ReturnType<typeof getSql>): Promise<string[]> {
  const rows = await sql<{ pattern: string }[]>`
    SELECT pattern FROM chain_patterns WHERE enabled = TRUE
  `;
  return rows.map((r) => r.pattern);
}

export async function ingestSample(opts: { filePath: string }): Promise<IngestSummary> {
  const sql = getSql();
  const fullPath = resolve(process.cwd(), opts.filePath);
  const raw = await readFile(fullPath);
  const fileHash = createHash('sha256').update(raw).digest('hex');

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as FixtureRow[];

  const chainPatterns = await loadChainPatterns(sql);

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (source_name, source_url, status, file_hash, row_count)
    VALUES ('madrid_sample_fixture', ${fullPath}, 'running', ${fileHash}, ${records.length})
    RETURNING id
  `;
  if (!run) throw new Error('failed to create import_run');
  const importRunId = run.id;

  let insertedCount = 0;
  let updatedCount = 0;
  let excludedCount = 0;
  let highCount = 0;
  let mediumCount = 0;

  try {
    for (const r of records) {
      const x = Number(r.x_25830);
      const y = Number(r.y_25830);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`invalid coordinates for ${r.source_local_id}`);
      }

      const scored = scoreCandidate({
        name: r.name,
        epigraphCodes: [r.epigraph_code],
        officialStatus: r.official_status,
        openingHoursOsm: null,
        chainPatterns,
      });

      if (scored.level === 'excluded') excludedCount += 1;
      if (scored.level === 'high') highCount += 1;
      if (scored.level === 'medium') mediumCount += 1;

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
          ${r.source_local_id}, 'madrid_sample_fixture', ${r.name}, ${normalizeName(r.name)},
          ${r.address || null}, ${r.postal_code || null}, ${r.district || null}, ${r.neighbourhood || null},
          ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 25830), 4326),
          ${scored.placeType}, ${scored.sellsTakeawayBeer}, ${scored.sellsOnsiteBeer},
          NULL, ${scored.badges}, ${scored.score}, ${scored.level},
          ${scored.scoringVersion}, ${scored.isChain}, ${r.official_status || null},
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
      if (!row) throw new Error('upsert returned no row');
      if (row.xmax === '0') insertedCount += 1;
      else updatedCount += 1;

      await sql`DELETE FROM store_activities WHERE store_id = ${row.id}`;
      await sql`
        INSERT INTO store_activities (store_id, epigraph_code, epigraph_description, is_target_epigraph)
        VALUES (${row.id}, ${r.epigraph_code}, ${r.epigraph_description || null}, ${isTargetEpigraphV2(r.epigraph_code)})
      `;
    }

    await sql`
      UPDATE import_runs SET
        status = 'succeeded',
        finished_at = now(),
        inserted_count = ${insertedCount},
        updated_count = ${updatedCount},
        deactivated_count = 0
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
    rowCount: records.length,
    insertedCount,
    updatedCount,
    excludedCount,
    highCount,
    mediumCount,
    fileHash,
  };
}
