import { getSql } from '@cervezadonde/db';
import OpeningHours from 'opening_hours';

export async function correctPlaceHours(
  sourceId: string,
  hours: string,
  reviewer: string,
  note: string,
  days: number,
) {
  if (!reviewer.trim() || !note.trim() || !Number.isInteger(days) || days < 1 || days > 180)
    throw new Error('Reviewer, evidence note and expiry of 1–180 days required');
  new OpeningHours(hours);
  const sql = getSql();
  const [place] =
    await sql`SELECT normalized_name FROM stores WHERE source_name='osm' AND source_local_id=${sourceId}`;
  if (!place) throw new Error('OSM place not found');
  return sql`INSERT INTO place_corrections(source_name,source_local_id,normalized_name,kind,hours,valid_until,reviewer,note)
    VALUES ('osm',${sourceId},${place.normalized_name},'hours',${hours},now()+make_interval(days=>${days}),${reviewer.trim()},${note.trim()}) RETURNING id`;
}

export async function revokePlaceCorrection(id: string, reviewer: string, note: string) {
  if (!/^\d+$/.test(id) || !reviewer.trim() || !note.trim())
    throw new Error('Correction id, reviewer and reason required');
  return getSql()`UPDATE place_corrections SET revoked_at=now(),note=note||${`\nRevoked by ${reviewer.trim()}: ${note.trim()}`}
    WHERE id=${id} AND revoked_at IS NULL RETURNING id`;
}

export async function listPlaceReports() {
  return getSql()`SELECT id,place_name,source_name,source_local_id,normalized_name,kind,created_at
    FROM place_reports WHERE status='pending'
      AND (kind<>'closed_now' OR created_at>now()-interval '4 hours') ORDER BY created_at LIMIT 100`;
}

/** SSH/CLI only: no public moderation endpoint or embedded browser secret. */
export async function reviewPlaceReport(
  id: string,
  decision: string,
  reviewer: string,
  note: string,
) {
  if (
    !/^\d+$/.test(id) ||
    !['accept', 'reject'].includes(decision) ||
    !reviewer.trim() ||
    !note.trim()
  )
    throw new Error('id, accept|reject, reviewer and note are required');
  return getSql().begin(async (tx) => {
    const [report] =
      await tx`SELECT * FROM place_reports WHERE id=${id} AND status='pending' FOR UPDATE`;
    if (!report) throw new Error('Pending report not found');
    if (decision === 'accept') {
      const [same] = await tx`SELECT id FROM stores WHERE source_name=${report.source_name}
        AND source_local_id=${report.source_local_id} AND normalized_name=${report.normalized_name}`;
      if (!same) throw new Error('Business identity changed; review the new place instead');
      if (
        report.kind === 'closed_now' &&
        Date.now() - new Date(report.created_at).getTime() >= 4 * 3_600_000
      )
        throw new Error('Temporary observation has expired');
      await tx`INSERT INTO place_corrections
        (source_name,source_local_id,normalized_name,kind,observed_at,valid_until,reviewer,note,report_id)
        VALUES (${report.source_name},${report.source_local_id},${report.normalized_name},${report.kind},
          ${report.created_at},${report.kind === 'closed_now' ? new Date(new Date(report.created_at).getTime() + 4 * 3_600_000) : null},${reviewer.trim()},${note.trim()},${id})`;
    }
    await tx`UPDATE place_reports SET status=${decision === 'accept' ? 'accepted' : 'rejected'},
      reviewer=${reviewer.trim()},review_note=${note.trim()},reviewed_at=now() WHERE id=${id}`;
    return { id, decision };
  });
}
