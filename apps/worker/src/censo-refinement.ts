import { type Sql, getSql } from '@cervezadonde/db';
import {
  type AcceptedCensoMatch,
  CENSO_MATCH_VERSION,
  type CensoMatchCandidate,
  type CensoMatchMethod,
  evaluateCensoMatch,
  selectHighPrecisionCensoMatches,
} from './censo-match.js';

const MATCH_RADIUS_M = 30;
const UPDATE_CHUNK = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function loadCandidates(sql: Sql): Promise<CensoMatchCandidate[]> {
  return sql<CensoMatchCandidate[]>`
    SELECT
      o.id::int                                                   AS "osmId",
      c.id::int                                                   AS "censoId",
      c.source_name                                               AS "censoSource",
      c.source_local_id                                           AS "censoLocalId",
      ST_Distance(o.geom::geography, c.geom::geography)::float8   AS "distanceM",
      o.normalized_name                                           AS "osmName",
      c.normalized_name                                           AS "censoName",
      o.place_type::text                                          AS "osmPlaceType",
      c.place_type::text                                          AS "censoPlaceType"
    FROM stores o
    JOIN stores c
      ON c.source_name LIKE 'censo_%'
     AND ST_DWithin(c.geom::geography, o.geom::geography, ${MATCH_RADIUS_M})
    WHERE o.source_name = 'osm'
      AND o.confidence_level <> 'excluded'
      -- Old proximity matches left valid censo rows as excluded. Do not use
      -- confidence_level here; use explicit negative evidence instead.
      AND c.place_type IS NOT NULL
      AND (c.sells_onsite_beer OR c.sells_takeaway_beer)
      AND NOT ('posible_cerrado' = ANY(c.badges))
      AND lower(COALESCE(c.official_status, '')) NOT IN ('cerrado', 'baja', 'baja r')
  `;
}

export type CensoMatchAudit = {
  matchVersion: string;
  candidatePairs: number;
  osmWithCandidates: number;
  censoWithCandidates: number;
  evidenceQualifiedPairs: number;
  ambiguousOsm: number;
  ambiguousCenso: number;
  acceptedMatches: number;
  currentOfficialBadges: number;
  bySource: Record<string, number>;
  byMethod: Record<CensoMatchMethod, number>;
};

async function summarizeAudit(
  sql: Sql,
  candidates: readonly CensoMatchCandidate[],
  matches: readonly AcceptedCensoMatch[],
): Promise<CensoMatchAudit> {
  const qualified = candidates
    .map(evaluateCensoMatch)
    .filter((match): match is AcceptedCensoMatch => match !== null);
  const osmQualifiedCounts = new Map<number, number>();
  const censoQualifiedCounts = new Map<number, number>();
  for (const match of qualified) {
    osmQualifiedCounts.set(match.osmId, (osmQualifiedCounts.get(match.osmId) ?? 0) + 1);
    censoQualifiedCounts.set(match.censoId, (censoQualifiedCounts.get(match.censoId) ?? 0) + 1);
  }
  const [current] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM stores
    WHERE source_name = 'osm'
      AND confidence_level <> 'excluded'
      AND 'oficial' = ANY(badges)
  `;

  const bySource: Record<string, number> = {};
  const byMethod = {
    exact_name: 0,
    strong_name: 0,
    name_and_type: 0,
  } satisfies Record<CensoMatchMethod, number>;

  for (const match of matches) {
    bySource[match.censoSource] = (bySource[match.censoSource] ?? 0) + 1;
    byMethod[match.method] += 1;
  }

  return {
    matchVersion: CENSO_MATCH_VERSION,
    candidatePairs: candidates.length,
    osmWithCandidates: new Set(candidates.map((candidate) => candidate.osmId)).size,
    censoWithCandidates: new Set(candidates.map((candidate) => candidate.censoId)).size,
    evidenceQualifiedPairs: qualified.length,
    ambiguousOsm: [...osmQualifiedCounts.values()].filter((count) => count > 1).length,
    ambiguousCenso: [...censoQualifiedCounts.values()].filter((count) => count > 1).length,
    acceptedMatches: matches.length,
    currentOfficialBadges: current?.count ?? 0,
    bySource,
    byMethod,
  };
}

export async function auditCensoMatches(sql: Sql = getSql()): Promise<CensoMatchAudit> {
  const candidates = await loadCandidates(sql);
  const matches = selectHighPrecisionCensoMatches(candidates);
  return summarizeAudit(sql, candidates, matches);
}

export type CensoRefinementSummary = CensoMatchAudit & {
  previousOfficialBadges: number;
  publishedOsm: number;
  hiddenCenso: number;
  hiddenFixtures: number;
};

/**
 * Rebuild all OSM↔censo evidence from scratch and enforce the serving policy:
 * active OSM is publishable; censo-only and fixtures are retained but hidden.
 */
export async function applyCensoRefinement(sql: Sql = getSql()): Promise<CensoRefinementSummary> {
  const candidates = await loadCandidates(sql);
  const matches = selectHighPrecisionCensoMatches(candidates);
  const audit = await summarizeAudit(sql, candidates, matches);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE stores
      SET
        is_published = FALSE,
        publication_reason = CASE
          WHEN 'posible_cerrado' = ANY(badges)
            OR lower(COALESCE(official_status, '')) IN ('cerrado', 'baja', 'baja r')
            THEN 'censo_source_closed'
          ELSE 'censo_only_unconfirmed'
        END,
        updated_at = now()
      WHERE source_name LIKE 'censo_%'
    `;
    await tx`
      UPDATE stores
      SET
        is_published = FALSE,
        publication_reason = 'development_fixture',
        updated_at = now()
      WHERE source_name = 'madrid_sample_fixture'
    `;
    await tx`
      UPDATE stores
      SET
        is_published = (confidence_level <> 'excluded'),
        publication_reason = CASE
          WHEN confidence_level = 'excluded' THEN 'osm_missing_latest_extract'
          ELSE NULL
        END,
        -- Censo data is identity evidence only. These columns were copied by
        -- the legacy proximity merge and have no per-field provenance, so
        -- retaining them after rebuilding the relation would leak stale
        -- official data onto otherwise canonical OSM rows.
        district = NULL,
        neighbourhood = NULL,
        official_status = NULL,
        last_seen_in_official_source_at = NULL,
        badges = array_remove(badges, 'oficial'),
        matched_censo_source = NULL,
        matched_censo_local_id = NULL,
        censo_match_version = NULL,
        censo_match_method = NULL,
        censo_match_distance_m = NULL,
        censo_match_name_similarity = NULL,
        updated_at = now()
      WHERE source_name = 'osm'
    `;

    for (const part of chunk(matches, UPDATE_CHUNK)) {
      const osmIds = part.map((match) => match.osmId);
      const censoIds = part.map((match) => match.censoId);
      const sources = part.map((match) => match.censoSource);
      const localIds = part.map((match) => match.censoLocalId);
      const methods = part.map((match) => match.method);
      const distances = part.map((match) => match.distanceM);
      const similarities = part.map((match) => match.nameSimilarity);

      await tx`
        WITH selected AS (
          SELECT *
          FROM unnest(
            ${osmIds}::bigint[],
            ${censoIds}::bigint[],
            ${sources}::text[],
            ${localIds}::text[],
            ${methods}::text[],
            ${distances}::float8[],
            ${similarities}::float8[]
          ) AS m(
            osm_id, censo_id, censo_source, censo_local_id,
            method, distance_m, name_similarity
          )
        )
        UPDATE stores o
        SET
          badges = array_append(array_remove(o.badges, 'oficial'), 'oficial'),
          matched_censo_source = m.censo_source,
          matched_censo_local_id = m.censo_local_id,
          censo_match_version = ${CENSO_MATCH_VERSION},
          censo_match_method = m.method,
          censo_match_distance_m = m.distance_m,
          censo_match_name_similarity = m.name_similarity,
          updated_at = now()
        FROM selected m
        WHERE o.id = m.osm_id
      `;

      await tx`
        UPDATE stores
        SET publication_reason = 'matched_to_osm', updated_at = now()
        WHERE id = ANY(${censoIds}::bigint[])
      `;
    }
  });

  const [counts] = await sql<
    { published_osm: number; hidden_censo: number; hidden_fixtures: number }[]
  >`
    SELECT
      count(*) FILTER (
        WHERE source_name = 'osm' AND is_published
      )::int AS published_osm,
      count(*) FILTER (
        WHERE source_name LIKE 'censo_%' AND NOT is_published
      )::int AS hidden_censo,
      count(*) FILTER (
        WHERE source_name = 'madrid_sample_fixture' AND NOT is_published
      )::int AS hidden_fixtures
    FROM stores
  `;

  return {
    ...audit,
    previousOfficialBadges: audit.currentOfficialBadges,
    publishedOsm: counts?.published_osm ?? 0,
    hiddenCenso: counts?.hidden_censo ?? 0,
    hiddenFixtures: counts?.hidden_fixtures ?? 0,
  };
}
