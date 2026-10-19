import { getSql } from '@cervezadonde/db';
import { PlaceReport } from '@cervezadonde/shared';
import type { FastifyInstance } from 'fastify';

/** Bounded, expiring abuse budget. No IP or browser fingerprint is persisted. */
export function createReportBudget() {
  const hits = new Map<string, { count: number; until: number }>();
  return (ip: string, now = Date.now()) => {
    for (const [key, item] of hits) if (item.until <= now) hits.delete(key);
    const item = hits.get(ip);
    if (item) return ++item.count <= 5;
    if (hits.size >= 10_000) return false;
    hits.set(ip, { count: 1, until: now + 10 * 60_000 });
    return true;
  };
}

export async function registerReportRoutes(app: FastifyInstance) {
  const allow = createReportBudget();
  const origins = new Set(
    (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  );
  app.post<{ Params: { id: string } }>('/:id/reports', { bodyLimit: 1024 }, async (req, reply) => {
    if (!req.headers.origin || !origins.has(req.headers.origin))
      return reply.code(403).send({ error: 'origin_not_allowed' });
    if (!allow(req.ip)) return reply.code(429).send({ error: 'too_many_reports' });
    const parsed = PlaceReport.safeParse(req.body);
    if (!parsed.success || !/^\d{1,18}$/.test(req.params.id))
      return reply.code(400).send({ error: 'invalid_report' });
    const sql = getSql();
    const [place] = await sql<
      { source_name: string; source_local_id: string; normalized_name: string; name: string }[]
    >`
      SELECT source_name, source_local_id, normalized_name, name FROM serving_stores
      WHERE id=${req.params.id} AND source_name='osm' LIMIT 1
    `;
    if (!place) return reply.code(404).send({ error: 'place_not_found' });
    await sql`
      INSERT INTO place_reports (source_name,source_local_id,normalized_name,place_name,kind)
      VALUES (${place.source_name},${place.source_local_id},${place.normalized_name},${place.name},${parsed.data.kind})
      ON CONFLICT (source_name,source_local_id,normalized_name,kind) WHERE status='pending' DO NOTHING
    `;
    return reply.code(202).send({ status: 'pending_review' });
  });
}
