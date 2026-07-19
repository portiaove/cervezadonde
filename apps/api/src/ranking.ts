import type { NearbyStore } from '@cervezadonde/shared';

/**
 * Existence-floor rank for the "nearest open beer" answer. Corroborated places
 * — anything a human has mapped in OSM (`verified` = OSM + official censo,
 * `mapped` = OSM only) — rank ahead of single-source, censo-only `unverified`
 * ones. Lower number = surfaced first.
 *
 * Rationale (docs/16-existence-confidence.md): the flagship answer is high
 * stakes — send someone to a shut shop once and they stop trusting the app —
 * so we never *lead* with a place we can't stand behind. Distance breaks ties
 * within a tier; an unverified place only appears as an honest fallback when
 * nothing corroborated is open nearby.
 */
export const existenceRank = (v: NearbyStore['verification']): number =>
  v === 'unverified' ? 1 : 0;

/**
 * Order open candidates existence-floor first, then by distance. Pure and
 * stable; does not mutate the input. Callers slice to the requested limit
 * afterwards (limit=1 → the single nearest corroborated open place, or the
 * nearest unverified one when none is corroborated).
 */
export function rankOpenByTrustThenDistance<
  T extends { verification: NearbyStore['verification']; distance_m: number },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      existenceRank(a.verification) - existenceRank(b.verification) || a.distance_m - b.distance_m,
  );
}
