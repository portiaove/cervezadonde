import { describe, expect, it } from 'vitest';
import { hoursForBusiness } from '../src/sources/schemaorg.js';
const identity = {
  name: 'Tower Paradise',
  address: 'Calle Lope de Haro 24',
  lat: 40.4569483,
  lng: -3.7038843,
};
const business = {
  '@type': 'BarOrPub',
  name: identity.name,
  address: { streetAddress: identity.address },
  openingHours: 'Mo-Su 20:30-02:30',
};
const html = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
describe('branch-specific website hours', () => {
  it('accepts the matching business, not unrelated page hours', () =>
    expect(hoursForBusiness(html(business), identity)).toBe('Mo-Su 20:30-02:30'));
  it('rejects missing identity, other branches and reservation services', () => {
    expect(hoursForBusiness(html({ ...business, name: 'Another bar' }), identity)).toBeNull();
    expect(hoursForBusiness(html({ ...business, address: undefined }), identity)).toBeNull();
    expect(hoursForBusiness(html({ ...business, '@type': 'Reservation' }), identity)).toBeNull();
    expect(
      hoursForBusiness(html({ ...business, geo: { latitude: 41, longitude: 2 } }), identity),
    ).toBeNull();
  });
  it('does not combine conflicting business schedules or department hours', () => {
    expect(
      hoursForBusiness(
        html([business, { ...business, openingHours: 'Mo-Su 08:00-18:00' }]),
        identity,
      ),
    ).toBeNull();
    expect(
      hoursForBusiness(
        html({ ...business, department: { openingHours: 'Mo-Su 09:00-22:00' } }),
        identity,
      ),
    ).toBe('Mo-Su 20:30-02:30');
  });
});
