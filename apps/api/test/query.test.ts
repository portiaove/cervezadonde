import { ClusterQuery, MapQuery, NearbyQuery } from '@cervezadonde/shared';
import { describe, expect, it } from 'vitest';

describe('HTTP boolean filters', () => {
  const bbox = { north: '41', south: '40', east: '-3', west: '-4' };
  it('keeps false query parameters false', () => {
    expect(
      NearbyQuery.parse({ lat: '40', lng: '-3', open_now: 'false', hide_chains: 'false' }),
    ).toMatchObject({ open_now: false, hide_chains: false });
    expect(MapQuery.parse({ ...bbox, open_now: 'false', hide_chains: 'true' })).toMatchObject({
      open_now: false,
      hide_chains: true,
    });
    expect(ClusterQuery.parse({ ...bbox, cell: '1', hide_chains: 'false' }).hide_chains).toBe(
      false,
    );
  });
  it('rejects ambiguous values instead of silently enabling a filter', () => {
    expect(MapQuery.safeParse({ ...bbox, open_now: 'no' }).success).toBe(false);
  });
});
