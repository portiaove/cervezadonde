import { describe, expect, it } from 'vitest';
import { isMadridMunicipality, timeZoneForPlace } from '../src/geography.js';

describe('geographic policy scope', () => {
  it('uses the municipal polygon rather than accepting every point in its bounding box', () => {
    expect(isMadridMunicipality({ lat: 40.4168, lng: -3.7038 })).toBe(true);
    expect(isMadridMunicipality({ lat: 40.4913, lng: -3.5931 })).toBe(true); // Barajas airport
    expect(isMadridMunicipality({ lat: 40.326, lng: -3.765 })).toBe(false); // Leganés
    expect(isMadridMunicipality({ lat: 40.437, lng: -3.813 })).toBe(false); // Pozuelo
    expect(isMadridMunicipality({ lat: 41.387, lng: 2.17 })).toBe(false);
  });
  it('distinguishes the Canary timezone from peninsula and Balearic time', () => {
    expect(timeZoneForPlace({ lat: 28.467, lng: -16.25 })).toBe('Atlantic/Canary');
    expect(timeZoneForPlace({ lat: 39.57, lng: 2.65 })).toBe('Europe/Madrid');
  });
});
