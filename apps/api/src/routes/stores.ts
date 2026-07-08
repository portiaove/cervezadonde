import type { FastifyInstance } from 'fastify';
import { getSql, type Sql } from '@cervezadonde/db';
import {
  type Intent,
  MapQuery,
  type MapResponse,
  type MapStore,
  NearbyQuery,
  type NearbyResponse,
  type NearbyStore,
  type Ordinance,
  type PlaceType,
} from '@cervezadonde/shared';
import {
  ORDINANCE,
  canSellBeerNow,
  isAlcoholTakeawayProhibited,
} from '../openNow.js';

type SharedRow = {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  neighbourhood: string | null;
  lng: number;
  lat: number;
  primary_category: NearbyStore['primary_category'];
  place_type: PlaceType | null;
  sells_takeaway_beer: boolean;
  sells_onsite_beer: boolean;
  opening_hours_osm: string | null;
  badges: NearbyStore['badges'];
  confidence_level: NearbyStore['confidence_level'];
  confidence_score: number;
  is_chain: boolean;
};

type NearbyRow = SharedRow & {
  source_local_id: string | null;
  distance_m: number;
};

const parseNow = (at_time: string | undefined): Date | null => {
  if (!at_time) return new Date();
  const d = new Date(at_time);
  return Number.isNaN(d.getTime()) ? null : d;
};

const buildOrdinance = (now: Date): Ordinance => ({
  takeaway_allowed: !isAlcoholTakeawayProhibited(now),
  window: ORDINANCE.label,
});

const enrichWithOpenNow = <T extends SharedRow>(
  row: T,
  now: Date,
): Omit<T, 'opening_hours_osm'> & { open_now: ReturnType<typeof canSellBeerNow> } => {
  const open_now = canSellBeerNow(
    {
      place_type: row.place_type ?? 'otro',
      sells_takeaway_beer: row.sells_takeaway_beer,
      opening_hours_osm: row.opening_hours_osm,
    },
    now,
  );
  const { opening_hours_osm: _hours, ...rest } = row;
  return { ...rest, open_now };
};

/** Translate an intent string into SQL flag filters. */
const intentClause = (sql: Sql, intent: Intent | undefined) => {
  if (intent === 'consume_aqui') return sql`AND s.sells_onsite_beer = TRUE`;
  if (intent === 'para_llevar') return sql`AND s.sells_takeaway_beer = TRUE`;
  return sql``;
};

const placeTypeClause = (sql: Sql, placeTypes: PlaceType[] | undefined) => {
  if (!placeTypes || placeTypes.length === 0) return sql``;
  return sql`AND s.place_type::text = ANY(${placeTypes})`;
};

const hideChainsClause = (sql: Sql, hide: boolean) =>
  hide ? sql`AND s.is_chain = FALSE` : sql``;

const minConfidenceClause = (
  sql: Sql,
  level: NearbyStore['confidence_level'] | undefined,
) => (level ? sql`AND s.confidence_level::text = ${level}` : sql``);

export async function registerStoresRoutes(app: FastifyInstance): Promise<void> {
  app.get('/nearby', async (req, reply) => {
    const parsed = NearbyQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const {
      lat,
      lng,
      radius_m,
      limit,
      place_type,
      intent,
      open_now,
      at_time,
      min_confidence,
      hide_chains,
    } = parsed.data;

    const now = parseNow(at_time);
    if (!now) return reply.code(400).send({ error: 'invalid_at_time' });

    const sql = getSql();
    const rows = await sql<NearbyRow[]>`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography AS g
      )
      SELECT
        s.id::text                                          AS id,
        s.source_local_id                                   AS source_local_id,
        s.name                                              AS name,
        s.address                                           AS address,
        s.district                                          AS district,
        s.neighbourhood                                     AS neighbourhood,
        ST_X(s.geom)::float8                                AS lng,
        ST_Y(s.geom)::float8                                AS lat,
        ST_Distance(s.geom::geography, origin.g)::float8    AS distance_m,
        s.primary_category                                  AS primary_category,
        s.place_type::text                                  AS place_type,
        s.sells_takeaway_beer                               AS sells_takeaway_beer,
        s.sells_onsite_beer                                 AS sells_onsite_beer,
        s.opening_hours_osm                                 AS opening_hours_osm,
        s.badges                                            AS badges,
        s.confidence_level                                  AS confidence_level,
        s.confidence_score                                  AS confidence_score,
        s.is_chain                                          AS is_chain
      FROM stores s, origin
      WHERE ST_DWithin(s.geom::geography, origin.g, ${radius_m})
        AND s.confidence_level <> 'excluded'
        ${intentClause(sql, intent)}
        ${placeTypeClause(sql, place_type)}
        ${hideChainsClause(sql, hide_chains)}
        ${minConfidenceClause(sql, min_confidence)}
      ORDER BY s.geom::geography <-> origin.g
      LIMIT ${limit}
    `;

    let results = rows.map((r) => {
      const enriched = enrichWithOpenNow(r, now);
      return {
        ...enriched,
        distance_m: Math.round(r.distance_m),
        badges: r.badges ?? [],
      } satisfies NearbyStore;
    });

    if (open_now) results = results.filter((r) => r.open_now.sells_beer_now);

    const response: NearbyResponse = {
      now: now.toISOString(),
      ordinance: buildOrdinance(now),
      results,
    };
    return response;
  });

  app.get('/map', async (req, reply) => {
    const parsed = MapQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const {
      north,
      south,
      east,
      west,
      limit,
      place_type,
      intent,
      open_now,
      at_time,
      min_confidence,
      hide_chains,
    } = parsed.data;

    const now = parseNow(at_time);
    if (!now) return reply.code(400).send({ error: 'invalid_at_time' });

    const sql = getSql();
    const rows = await sql<SharedRow[]>`
      SELECT
        s.id::text             AS id,
        s.name                 AS name,
        s.address              AS address,
        s.district             AS district,
        s.neighbourhood        AS neighbourhood,
        ST_X(s.geom)::float8   AS lng,
        ST_Y(s.geom)::float8   AS lat,
        s.primary_category     AS primary_category,
        s.place_type::text     AS place_type,
        s.sells_takeaway_beer  AS sells_takeaway_beer,
        s.sells_onsite_beer    AS sells_onsite_beer,
        s.opening_hours_osm    AS opening_hours_osm,
        s.badges               AS badges,
        s.confidence_level     AS confidence_level,
        s.confidence_score     AS confidence_score,
        s.is_chain             AS is_chain
      FROM stores s
      WHERE s.geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
        AND s.confidence_level <> 'excluded'
        ${intentClause(sql, intent)}
        ${placeTypeClause(sql, place_type)}
        ${hideChainsClause(sql, hide_chains)}
        ${minConfidenceClause(sql, min_confidence)}
      ORDER BY s.confidence_score DESC, s.id
      LIMIT ${limit}
    `;

    let results = rows.map((r) => {
      const enriched = enrichWithOpenNow(r, now);
      return { ...enriched, badges: r.badges ?? [] } satisfies MapStore;
    });

    if (open_now) results = results.filter((r) => r.open_now.sells_beer_now);

    const response: MapResponse = {
      now: now.toISOString(),
      ordinance: buildOrdinance(now),
      results,
    };
    return response;
  });
}
