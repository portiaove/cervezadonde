import type { NearbyStore } from '@cervezadonde/shared';
import { describe, expect, it } from 'vitest';
import { existenceRank, rankOpenByTrustThenDistance } from '../src/ranking.js';

type Row = { id: string; verification: NearbyStore['verification']; distance_m: number };
const row = (id: string, verification: Row['verification'], distance_m: number): Row => ({
  id,
  verification,
  distance_m,
});

describe('existenceRank', () => {
  it('ranks corroborated (verified/mapped) ahead of unverified', () => {
    expect(existenceRank('verified')).toBeLessThan(existenceRank('unverified'));
    expect(existenceRank('mapped')).toBeLessThan(existenceRank('unverified'));
  });
  it('treats verified and mapped as the same floor (both are in OSM)', () => {
    expect(existenceRank('verified')).toBe(existenceRank('mapped'));
  });
});

describe('rankOpenByTrustThenDistance', () => {
  it('puts a corroborated place first even when an unverified one is closer', () => {
    // the Eugenio Salazar case: dead censo-only shop at 40m vs a real bar at 85m
    const ranked = rankOpenByTrustThenDistance([
      row('bazar', 'unverified', 40),
      row('bar', 'mapped', 85),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['bar', 'bazar']);
  });

  it('within the corroborated tier, nearest wins (verified vs mapped are equal)', () => {
    const ranked = rankOpenByTrustThenDistance([
      row('far-verified', 'verified', 300),
      row('near-mapped', 'mapped', 120),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['near-mapped', 'far-verified']);
  });

  it('falls back to the nearest unverified when nothing corroborated is open', () => {
    const ranked = rankOpenByTrustThenDistance([
      row('far-unverified', 'unverified', 900),
      row('near-unverified', 'unverified', 50),
    ]);
    expect(ranked[0]?.id).toBe('near-unverified');
  });

  it('is stable and does not mutate the input', () => {
    const input = [row('a', 'unverified', 40), row('b', 'mapped', 85)];
    const snapshot = input.map((r) => r.id);
    rankOpenByTrustThenDistance(input);
    expect(input.map((r) => r.id)).toEqual(snapshot); // original order untouched
  });

  it('slicing to 1 yields the trustworthy answer for the card', () => {
    const ranked = rankOpenByTrustThenDistance([
      row('bazar', 'unverified', 30),
      row('super', 'verified', 210),
      row('bar', 'mapped', 140),
    ]);
    expect(ranked.slice(0, 1).map((r) => r.id)).toEqual(['bar']);
  });
});
