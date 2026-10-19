import { getSql } from '@cervezadonde/db';
import { BEER_POLICY_VERSION, assessBeerEvidence } from '@cervezadonde/shared';
import { parseGeojsonl } from './ingest-osm-pbf.js';
import { classifyOsmPlace } from './sources/osm.js';

/** Re-score retained rows from complete cached extracts. No insertion/pruning,
 * no invented observation dates and no writes to production-owned evidence. */
export async function rebuildOsmEvidence(files: string[]) {
  const parts = await Promise.all(files.map(parseGeojsonl));
  const places = parts.flat();
  const canary = places.filter(
    (p) => p.lat >= 27.5 && p.lat <= 29.6 && p.lon >= -18.3 && p.lon <= -13.2,
  ).length;
  if (
    parts.length !== 2 ||
    parts.some((p) => p.length < 5000) ||
    canary < 5000 ||
    places.length < 170_000
  )
    throw new Error('Expected both complete national extracts; refusing partial evidence rebuild');
  return getSql().begin(async (tx) => {
    let updated = 0;
    for (let i = 0; i < places.length; i += 2000) {
      const batch = places.slice(i, i + 2000);
      const assessments = batch.map((p) =>
        assessBeerEvidence(p.tags, classifyOsmPlace(p).placeType),
      );
      const rows = await tx`UPDATE stores s SET
        osm_tags=t.tags::jsonb, osm_element_updated_at=t.edited::timestamptz,
        beer_eligible=(t.eligible=1),beer_evidence=t.evidence,beer_evidence_reason=t.reason,
        confidence_score=CASE WHEN t.evidence='documented' THEN 80 ELSE 55 END,
        confidence_level=CASE WHEN s.confidence_level='excluded' THEN 'excluded'::confidence_level
          WHEN t.evidence='documented' THEN 'high'::confidence_level ELSE 'medium'::confidence_level END,
        scoring_version=${BEER_POLICY_VERSION}
        FROM unnest(${batch.map((p) => p.sourceLocalId ?? `${p.osmType}/${p.osmId}`)}::text[],${batch.map((p) => JSON.stringify(p.tags))}::text[],
          ${batch.map((p) => p.osmUpdatedAt ?? null)}::text[],${assessments.map((a) => (a.eligible ? 1 : 0))}::int[],
          ${assessments.map((a) => a.status)}::text[],${assessments.map((a) => a.reason)}::text[])
          AS t(id,tags,edited,eligible,evidence,reason)
        WHERE s.source_name='osm' AND s.source_local_id=t.id RETURNING s.id`;
      updated += rows.length;
    }
    if (updated < 170_000)
      throw new Error('Evidence rebuild did not match the national serving snapshot');
    return { parsed: places.length, updated };
  });
}
