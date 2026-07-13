import { describe, expect, it } from 'vitest';
import { featureToPlace } from '../src/ingest-osm-pbf.js';

const feat = (properties: Record<string, string>) => ({
  id: 'w1',
  geometry: { type: 'Point', coordinates: [-3.7, 40.4] },
  properties,
});

describe('featureToPlace — fuel station gate', () => {
  it('keeps a fuel station that has opening_hours (staffed/retail proxy)', () => {
    const p = featureToPlace(feat({ amenity: 'fuel', opening_hours: 'Mo-Su 00:00-24:00' }));
    expect(p).not.toBeNull();
    expect(p?.amenityTag).toBe('fuel');
  });

  it('keeps a fuel station co-tagged with a convenience shop even without hours', () => {
    expect(featureToPlace(feat({ amenity: 'fuel', shop: 'convenience' }))).not.toBeNull();
  });

  it('drops a bare fuel pump with no shop and no hours', () => {
    expect(featureToPlace(feat({ amenity: 'fuel' }))).toBeNull();
  });

  it('drops an unattended/automated fuel station', () => {
    expect(
      featureToPlace(feat({ amenity: 'fuel', opening_hours: '24/7', automated: 'yes' })),
    ).toBeNull();
    expect(
      featureToPlace(feat({ amenity: 'fuel', opening_hours: '24/7', self_service: 'yes' })),
    ).toBeNull();
  });

  it('still keeps normal shops and bars', () => {
    expect(featureToPlace(feat({ shop: 'supermarket' }))).not.toBeNull();
    expect(featureToPlace(feat({ amenity: 'bar' }))).not.toBeNull();
  });
});
