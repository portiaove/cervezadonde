import { z } from 'zod';

export const ConfidenceLevel = z.enum(['high', 'medium', 'low', 'excluded']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

export const Badge = z.enum([
  // legacy
  'alimentacion',
  'conveniencia',
  '24h',
  'bebidas',
  'snacks',
  'bodega',
  'verificado',
  'horario_no_confirmado',
  'posible_cerrado',
  // beer product (M6+): see docs/04-domain-model.md
  'bar',
  'supermercado',
  'tienda_24h',
  'abierto_ahora',
  'cierra_pronto',
  'vende_cerveza_para_llevar',
  'vende_cerveza_in_situ',
  'no_puede_vender_ahora',
  // national (ADR-007): OSM store confirmed by an official municipal censo
  'oficial',
]);
export type Badge = z.infer<typeof Badge>;

/** @deprecated since M6 — superseded by PlaceType. Kept for v1 API compatibility. */
export const PrimaryCategory = z.enum([
  'alimentacion',
  'conveniencia',
  'ultramarinos',
  'bodega',
  'snacks',
  'otro',
]);
export type PrimaryCategory = z.infer<typeof PrimaryCategory>;

/**
 * Functional category for the beer-now product (M6+).
 * Persisted as the `place_type` enum column on `stores`.
 * See docs/04-domain-model.md.
 */
export const PlaceType = z.enum([
  'bar',
  'supermercado',
  'alimentacion',
  'bodega',
  'tienda_24h',
  'gasolinera',
  'otro',
]);
export type PlaceType = z.infer<typeof PlaceType>;

/**
 * Server-computed open-now verdict for a place at a given instant.
 * See ADR-004 and apps/api/src/openNow.ts.
 */
/** Where the hours behind an open-now verdict came from. */
export const HoursSource = z.enum([
  'osm', // real opening_hours from OSM — "confirmado"
  'website', // crawled from the business's own site (crawl:hours) — "confirmado"
  'estimated', // default schedule for the place_type — "horario habitual"
  'none', // no hours and no applicable default
]);
export type HoursSource = z.infer<typeof HoursSource>;

export const OpenNowBlock = z.object({
  open: z.boolean(),
  closes_at: z.string().nullable(),
  sells_beer_now: z.boolean(),
  reason: z.string(),
  hours_source: HoursSource,
});
export type OpenNowBlock = z.infer<typeof OpenNowBlock>;

/**
 * Existence confidence — how independently confirmed it is that a place is
 * REAL and still there (distinct from `confidence_level`, which is
 * classification confidence, and from `hours_source`, which is openness).
 * Source-agnostic and national: derived from how many independent sources
 * corroborate the place. See docs/16-existence-confidence.md.
 *
 * OSM presence outweighs censo presence: OSM is community-curated and self-
 * cleans (a vanished place gets `posible_cerrado`), whereas an official censo
 * lags real closures by months/years (its bias is false positives — showing
 * shut premises as active).
 */
export const Verification = z.enum([
  'verified', // in OSM AND confirmed by an official censo (`oficial`) — two independent sources
  'mapped', // in OSM (a human mapped it), not in any official censo
  'unverified', // only in an official censo, absent from OSM — single source, not independently confirmed
]);
export type Verification = z.infer<typeof Verification>;

export const NearbyStore = z.object({
  id: z.string(),
  source_local_id: z.string().nullable(),
  name: z.string(),
  address: z.string().nullable(),
  district: z.string().nullable(),
  neighbourhood: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  distance_m: z.number(),
  primary_category: PrimaryCategory.nullable(),
  place_type: PlaceType.nullable(),
  sells_takeaway_beer: z.boolean(),
  sells_onsite_beer: z.boolean(),
  badges: z.array(Badge),
  confidence_level: ConfidenceLevel,
  confidence_score: z.number().int().min(0).max(100),
  is_chain: z.boolean(),
  open_now: OpenNowBlock,
  verification: Verification,
});
export type NearbyStore = z.infer<typeof NearbyStore>;
