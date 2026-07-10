import { getSql } from '@cervezadonde/db';
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true }));

  app.get('/health/db', async (_req, reply) => {
    try {
      const sql = getSql();
      const [row] = await sql<{ postgis_version: string }[]>`
        SELECT postgis_version() AS postgis_version
      `;
      return { ok: true, postgis: row?.postgis_version ?? null };
    } catch (err) {
      app.log.error({ err }, 'db health failed');
      return reply.code(503).send({ ok: false });
    }
  });
}
