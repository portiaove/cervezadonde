import { getSql } from '@cervezadonde/db';
import type { FastifyInstance } from 'fastify';

// Public dataset metadata: when the serving data was last refreshed by the
// weekly pipeline (scripts/refresh-all.ps1) and how many places it holds.
// Kept separate from /health so the uptime probe stays DB-free and cheap.
export async function registerMetaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/meta', async (_req, reply) => {
    try {
      const sql = getSql();
      const [row] = await sql<
        {
          data_updated_at: Date | null;
          active_stores: string;
          stores_with_hours: string;
        }[]
      >`
        SELECT
          GREATEST(MAX(last_seen_osm_at), MAX(last_seen_in_official_source_at)) AS data_updated_at,
          count(*) FILTER (WHERE confidence_level <> 'excluded')                AS active_stores,
          count(*) FILTER (
            WHERE confidence_level <> 'excluded'
              AND (opening_hours_osm IS NOT NULL OR opening_hours_web IS NOT NULL)
          )                                                                     AS stores_with_hours
        FROM stores
      `;
      return {
        // ISO 8601 (UTC); the client formats it to the user's locale.
        data_updated_at: row?.data_updated_at ?? null,
        active_stores: Number(row?.active_stores ?? 0),
        stores_with_hours: Number(row?.stores_with_hours ?? 0),
      };
    } catch (err) {
      app.log.error({ err }, 'meta query failed');
      return reply.code(503).send({ ok: false });
    }
  });
}
