import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { closeSql, getSql } from '@cervezadonde/db';
import Fastify from 'fastify';
import { persistOsmCanonical } from '../../worker/src/ingest-osm-canonical.js';
import { featureToPlace } from '../../worker/src/ingest-osm-pbf.js';
import {
  correctPlaceHours,
  reviewPlaceReport,
  revokePlaceCorrection,
} from '../../worker/src/place-review.js';
import { registerMetaRoutes } from '../src/routes/meta.js';
import { registerReportRoutes } from '../src/routes/reports.js';
import { registerStoresRoutes } from '../src/routes/stores.js';

// Never run the destructive snapshot simulation on production or public tables.
const original = process.env.DATABASE_URL;
assert.ok(original, 'DATABASE_URL required');
const connection = new URL(original);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname), 'Local DB only');
const schema = `quality_test_${randomBytes(6).toString('hex')}`;
assert.match(schema, /^quality_test_[a-f0-9]{12}$/);
process.env.TZ = 'UTC';
process.env.WEB_ORIGIN = 'http://quality.test';
let app: ReturnType<typeof Fastify> | undefined;
const admin = getSql();
const [before] = await admin`SELECT count(*)::int AS stores FROM public.stores`;
const fixtures = `INSERT INTO stores
  (id,source_name,source_local_id,name,normalized_name,address,geom,place_type,
   sells_onsite_beer,sells_takeaway_beer,opening_hours_osm,confidence_level,confidence_score,is_published,beer_eligible)
  VALUES (70654,'osm','n9450850755','Tower Paradise','TOWER PARADISE',NULL,
    ST_SetSRID(ST_MakePoint(-3.7038843,40.4569483),4326),'bar',true,false,NULL,'medium',55,true,true),
  (1046545,'osm','a1320501512','Repsol','REPSOL','Calle de Francos Rodríguez 75',
    ST_SetSRID(ST_MakePoint(-3.71377404,40.45789826),4326),'gasolinera',false,true,'Mo-Sa 07:30-21:30','medium',55,true,false)`;
try {
  const [definition] =
    await admin`SELECT pg_get_viewdef('public.serving_stores'::regclass,true) AS sql`;
  await admin.begin(async (tx) => {
    await tx.unsafe(`CREATE SCHEMA ${schema}`);
    await tx.unsafe(`SET LOCAL search_path TO ${schema},public`);
    for (const table of [
      'stores',
      'import_runs',
      'store_activities',
      'place_reports',
      'place_corrections',
    ]) {
      await tx.unsafe(
        `CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
      );
    }
    // Independent serials: tests must not consume production-owned sequences.
    for (const table of [
      'stores',
      'import_runs',
      'store_activities',
      'place_reports',
      'place_corrections',
    ]) {
      await tx.unsafe(`CREATE SEQUENCE ${table}_test_seq`);
      await tx.unsafe(
        `ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${schema}.${table}_test_seq')`,
      );
    }
    await tx.unsafe(
      `CREATE VIEW serving_stores AS ${String(definition.sql).replaceAll('public.', `${schema}.`)}`,
    );
    await tx.unsafe(fixtures);
  });
  await closeSql();
  connection.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = connection.toString();
  const sql = getSql();
  await sql`UPDATE stores SET opening_hours_osm='24/7' WHERE id=70654`;
  app = Fastify();
  await app.register(registerStoresRoutes, { prefix: '/stores' });
  await app.register(registerReportRoutes, { prefix: '/stores' });
  await app.register(registerMetaRoutes);
  const server = app;
  const paths = [
    '/stores/nearby?lat=40.4569483&lng=-3.7038843&radius_m=3000&limit=100&open_now=false',
    '/stores/map?north=40.48&south=40.43&east=-3.68&west=-3.74&limit=100',
  ] as const;
  const visible = async () => {
    for (const path of paths) {
      const res = await server.inject(path);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().results.length, 1);
    }
  };
  const hidden = async () => {
    for (const path of [
      ...paths,
      '/stores/nearby?lat=40.4569483&lng=-3.7038843&radius_m=3000&open_now=true',
    ]) {
      const res = await server.inject(path);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().results.length, 0);
    }
    assert.equal((await server.inject('/meta')).json().active_stores, 0);
    assert.equal(
      (
        await server.inject('/stores/clusters?north=40.48&south=40.43&east=-3.68&west=-3.74&cell=1')
      ).json().clusters.length,
      0,
    );
  };
  await visible(); // Pumps excluded; fixture bar visible.
  const post = {
    method: 'POST' as const,
    url: '/stores/70654/reports',
    headers: { origin: 'http://quality.test' },
    payload: { kind: 'no_beer' },
  };
  assert.equal((await app.inject(post)).statusCode, 202);
  assert.equal((await app.inject(post)).statusCode, 202);
  assert.equal((await sql`SELECT count(*)::int AS n FROM place_reports`)[0]?.n, 1);
  await visible(); // Anonymous report changes no recommendation.
  const [report] = await sql`SELECT id::text AS id FROM place_reports`;
  await reviewPlaceReport(report.id, 'accept', 'integration-test', 'Verified fixture only');
  await hidden();
  await sql`UPDATE stores SET website='https://old.example/',opening_hours_web='24/7',hours_web_observed_at=now() WHERE id=70654`;
  const reimport = featureToPlace({
    id: 'n9450850755',
    geometry: { type: 'Point', coordinates: [-3.7038843, 40.4569483] },
    properties: {
      amenity: 'bar',
      name: 'Tower Paradise',
      opening_hours: '24/7',
      website: 'https://new.example/',
      '@timestamp': 1666641923,
    },
  });
  assert.ok(reimport);
  await persistOsmCanonical(sql, [reimport], {
    sourceUrl: 'https://fixture.invalid/',
    fileHash: 'fixture',
    rowCount: 1,
    log: () => {},
    pruneStale: false,
  });
  const [reimported] =
    await sql`SELECT hours_web_observed_at,confidence_score,osm_element_updated_at FROM stores WHERE id=70654`;
  assert.equal(reimported.hours_web_observed_at, null);
  assert.equal(reimported.confidence_score, 55); // Hours do not prove beer retail.
  assert.equal(reimported.osm_element_updated_at.toISOString(), '2022-10-24T20:05:23.000Z');
  await hidden(); // Real canonical ingest cannot overwrite moderated evidence.
  await sql`UPDATE stores SET is_published=true,publication_reason=NULL WHERE id=70654`;
  await hidden(); // Re-ingest cannot resurrect an accepted negative observation.
  await sql.begin(async (tx) => {
    await tx`TRUNCATE store_activities,stores,import_runs RESTART IDENTITY RESTRICT`;
    await tx.unsafe(fixtures);
  });
  assert.equal((await sql`SELECT count(*)::int AS n FROM place_reports`)[0]?.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM place_corrections`)[0]?.n, 1);
  await hidden(); // Actual snapshot-shaped replacement, evidence retained.
  await sql`UPDATE stores SET normalized_name='NEW BUSINESS' WHERE id=70654`;
  await visible(); // Different business identity does not inherit the closure.
  await sql`UPDATE stores SET normalized_name='TOWER PARADISE',opening_hours_osm='24/7' WHERE id=70654`;
  await sql`UPDATE place_corrections SET revoked_at=now()`;
  await sql`INSERT INTO place_corrections(source_name,source_local_id,normalized_name,kind,observed_at,valid_until,reviewer,note)
    VALUES ('osm','n9450850755','TOWER PARADISE','closed_now',now()-interval '8 hours',now()-interval '4 hours','test','Expired fixture')`;
  await visible();
  await sql`INSERT INTO place_corrections(source_name,source_local_id,normalized_name,kind,reviewer,note)
    VALUES ('osm','n9450850755','TOWER PARADISE','wrong_hours','test','Disputed fixture')`;
  const unknown = (await app.inject(paths[0])).json().results[0].open_now;
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.sells_beer_now, false);
  const [correction] = await correctPlaceHours(
    'n9450850755',
    'Mo-Su 20:00-24:00',
    'test',
    'Reviewed fixture schedule',
    90,
  );
  const reviewed = (await app.inject(`${paths[0]}&at_time=2026-10-19T12:00:00Z`)).json().results[0]
    .open_now;
  assert.equal(reviewed.hours_source, 'reviewed');
  assert.equal(reviewed.status, 'closed');
  await revokePlaceCorrection(String(correction.id), 'test', 'Fixture revoked');
  assert.equal((await app.inject(paths[0])).json().results[0].open_now.status, 'unknown');
  const [pending] =
    await sql`INSERT INTO place_reports(source_name,source_local_id,normalized_name,place_name,kind)
    VALUES ('osm','n9450850755','TOWER PARADISE','Tower Paradise','closed_permanently') RETURNING id::text AS id`;
  await reviewPlaceReport(pending.id, 'reject', 'test', 'Insufficient evidence');
  assert.equal(
    (await sql`SELECT status FROM place_reports WHERE id=${pending.id}`)[0]?.status,
    'rejected',
  );
  await sql`INSERT INTO place_reports(source_name,source_local_id,normalized_name,place_name,kind,created_at)
    VALUES ('osm','n9450850755','TOWER PARADISE','Tower Paradise','closed_now',now()-interval '5 hours')`;
  assert.equal((await app.inject({ ...post, payload: { kind: 'closed_now' } })).statusCode, 202);
  const [temporary] = await sql`SELECT count(*) FILTER(WHERE status='pending')::int AS fresh,
    count(*) FILTER(WHERE reviewer='system:expiry')::int AS expired FROM place_reports WHERE kind='closed_now'`;
  assert.equal(temporary.fresh, 1);
  assert.equal(temporary.expired, 1);
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          'public routes',
          'fuel exclusion',
          'pending isolation',
          'deduplication',
          'moderation',
          'snapshot survival',
          'rename isolation',
          'temporary expiry',
          'disputed hours',
          'rejection',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  await closeSql();
  process.env.DATABASE_URL = original;
  const cleanup = getSql(original);
  // Only this generated, validated schema; never a user/production schema.
  await cleanup.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const [after] = await cleanup`SELECT count(*)::int AS stores FROM public.stores`;
  assert.equal(
    after?.stores,
    before?.stores,
    'Public catalogue changed during isolated integration test',
  );
  await closeSql();
}
