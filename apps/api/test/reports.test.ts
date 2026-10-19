import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReportRoutes } from '../src/routes/reports.js';
const query = vi.hoisted(() => vi.fn());
vi.mock('@cervezadonde/db', () => ({ getSql: () => query }));
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.stubEnv('WEB_ORIGIN', 'https://cervezadonde.es');
  query.mockReset();
  app = Fastify();
  await app.register(registerReportRoutes, { prefix: '/stores' });
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
const request = {
  method: 'POST' as const,
  url: '/stores/70654/reports',
  headers: { origin: 'https://cervezadonde.es' },
  payload: { kind: 'wrong_hours' },
};
describe('moderated reports HTTP boundary', () => {
  it('queues a report but never updates the catalogue or corrections', async () => {
    query
      .mockResolvedValueOnce([
        {
          source_name: 'osm',
          source_local_id: 'n9450850755',
          normalized_name: 'TOWER PARADISE',
          name: 'Tower Paradise',
        },
      ])
      .mockResolvedValueOnce([]);
    const response = await app.inject(request);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'pending_review' });
    expect(query).toHaveBeenCalledTimes(2);
    const statements = query.mock.calls.map((call) => call[0].join(' ')).join(' ');
    expect(statements).toContain('INSERT INTO place_reports');
    expect(statements).not.toContain('UPDATE');
    expect(statements).not.toContain('place_corrections');
  });
  it('rejects foreign origins and missing origins without touching DB', async () => {
    for (const headers of [{ origin: 'https://other.example' }, {}])
      expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects extra data, invalid kinds/IDs and oversized payloads', async () => {
    expect(
      (await app.inject({ ...request, payload: { kind: 'no_beer', email: 'not needed' } }))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ ...request, url: '/stores/not-an-id/reports' })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ ...request, payload: { kind: 'x'.repeat(2000) } })).statusCode).toBe(
      413,
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects missing/hidden records and throttles repeated submissions', async () => {
    query.mockResolvedValue([]);
    for (let n = 0; n < 5; n++) expect((await app.inject(request)).statusCode).toBe(404);
    expect((await app.inject(request)).statusCode).toBe(429);
  });
});
