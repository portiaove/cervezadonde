import { z } from 'zod';
import { ConfidenceLevel, NearbyStore, PlaceType } from './store.js';

// --- shared filter fragments -----------------------------------------------

export const Intent = z.enum(['consume_aqui', 'para_llevar']);
export type Intent = z.infer<typeof Intent>;

export const Ordinance = z.object({
  takeaway_allowed: z.boolean(),
  window: z.string(),
});
export type Ordinance = z.infer<typeof Ordinance>;

const placeTypeListParam = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : undefined,
  )
  .pipe(z.array(PlaceType).optional());

// --- Nearby (lat/lng + radius) --------------------------------------------

export const NearbyQuery = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
  radius_m: z.coerce.number().int().positive().max(5000).default(1000),
  limit: z.coerce.number().int().positive().max(200).default(50),
  place_type: placeTypeListParam,
  intent: Intent.optional(),
  open_now: z.coerce.boolean().default(false),
  at_time: z.string().optional(),
  min_confidence: ConfidenceLevel.optional(),
  hide_chains: z.coerce.boolean().default(false),
});
export type NearbyQuery = z.infer<typeof NearbyQuery>;

export const NearbyResponse = z.object({
  now: z.string(),
  ordinance: Ordinance,
  results: z.array(NearbyStore),
});
export type NearbyResponse = z.infer<typeof NearbyResponse>;

// --- Map (bbox-based, for viewport rendering) ------------------------------

export const MapQuery = z.object({
  north: z.coerce.number().gte(-90).lte(90),
  south: z.coerce.number().gte(-90).lte(90),
  east: z.coerce.number().gte(-180).lte(180),
  west: z.coerce.number().gte(-180).lte(180),
  limit: z.coerce.number().int().positive().max(2000).default(500),
  place_type: placeTypeListParam,
  intent: Intent.optional(),
  open_now: z.coerce.boolean().default(false),
  at_time: z.string().optional(),
  min_confidence: ConfidenceLevel.optional(),
  hide_chains: z.coerce.boolean().default(false),
});
export type MapQuery = z.infer<typeof MapQuery>;

/** Marker payload for the map view — no distance, no source_local_id. */
export const MapStore = NearbyStore.omit({
  distance_m: true,
  source_local_id: true,
});
export type MapStore = z.infer<typeof MapStore>;

export const MapResponse = z.object({
  now: z.string(),
  ordinance: Ordinance,
  results: z.array(MapStore),
});
export type MapResponse = z.infer<typeof MapResponse>;

// --- Clusters (server-side grid aggregation for wide zoom) ------------------

export const ClusterQuery = z.object({
  north: z.coerce.number().gte(-90).lte(90),
  south: z.coerce.number().gte(-90).lte(90),
  east: z.coerce.number().gte(-180).lte(180),
  west: z.coerce.number().gte(-180).lte(180),
  // Grid cell size in degrees (the client derives it from ~60px at the current
  // zoom). Clamped to a sane range so a cell is never degenerate or huge.
  cell: z.coerce.number().positive().min(0.0005).max(20),
  place_type: placeTypeListParam,
  intent: Intent.optional(),
  min_confidence: ConfidenceLevel.optional(),
  hide_chains: z.coerce.boolean().default(false),
});
export type ClusterQuery = z.infer<typeof ClusterQuery>;

/** One aggregated grid cell: real total count of stores it holds. */
export const Cluster = z.object({
  lng: z.number(),
  lat: z.number(),
  count: z.number().int(),
});
export type Cluster = z.infer<typeof Cluster>;

export const ClusterResponse = z.object({
  clusters: z.array(Cluster),
});
export type ClusterResponse = z.infer<typeof ClusterResponse>;
