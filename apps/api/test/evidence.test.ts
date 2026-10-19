import { PlaceReport, assessBeerEvidence } from '@cervezadonde/shared';
import { describe, expect, it } from 'vitest';
import { canSellBeerNow } from '../src/openNow.js';
import { createReportBudget } from '../src/routes/reports.js';

const now = new Date('2026-10-19T12:00:00Z');
const bar = {
  place_type: 'bar' as const,
  sells_takeaway_beer: false,
  opening_hours_osm: 'Mo-Su 09:00-22:00',
};
describe('evidence boundaries', () => {
  it('does not turn Francos Rodríguez pump hours into a beer recommendation', () => {
    expect(
      assessBeerEvidence({ amenity: 'fuel', opening_hours: 'Mo-Sa 07:30-21:30' }, 'gasolinera')
        .eligible,
    ).toBe(false);
    expect(
      canSellBeerNow({ ...bar, place_type: 'gasolinera', sells_takeaway_beer: true }, now).status,
    ).toBe('unknown');
  });
  it.each(['bar', 'supermercado', 'tienda_24h', 'alimentacion'] as const)(
    'never invents hours for %s',
    (place_type) => {
      expect(canSellBeerNow({ ...bar, place_type, opening_hours_osm: null }, now)).toMatchObject({
        status: 'unknown',
        sells_beer_now: false,
        hours_source: 'none',
      });
    },
  );
  it('requires retail evidence, with explicit negatives taking precedence', () => {
    expect(assessBeerEvidence({ shop: 'convenience' }, 'gasolinera').eligible).toBe(true);
    expect(assessBeerEvidence({ shop: 'convenience', alcohol: 'no' }, 'gasolinera').eligible).toBe(
      false,
    );
    expect(assessBeerEvidence({ shop: 'no', opening_hours: '24/7' }, 'gasolinera').eligible).toBe(
      false,
    );
    expect(assessBeerEvidence({ 'drink:beer': 'no' }, 'bar').status).toBe('no');
    expect(assessBeerEvidence({ 'drink:beer': 'yes' }, 'bar').status).toBe('documented');
  });
  it('does not use disputed, conflicting, undated or expired website hours', () => {
    expect(canSellBeerNow({ ...bar, hours_disputed: true }, now).status).toBe('unknown');
    expect(
      canSellBeerNow(
        {
          ...bar,
          opening_hours_web: 'Mo-Su 20:00-24:00',
          hours_web_observed_at: new Date('2026-10-18'),
        },
        now,
      ).status,
    ).toBe('unknown');
    for (const hours_web_observed_at of [null, new Date('2020-01-01'), new Date('2027-01-01')]) {
      expect(
        canSellBeerNow(
          { ...bar, opening_hours_osm: null, opening_hours_web: '24/7', hours_web_observed_at },
          now,
        ).status,
      ).toBe('unknown');
    }
  });
  it('uses a moderated correction without inheriting the disputed source', () => {
    expect(
      canSellBeerNow({ ...bar, hours_disputed: true, reviewed_hours: 'Mo-Su 20:00-24:00' }, now),
    ).toMatchObject({ status: 'closed', hours_source: 'reviewed' });
  });
  it('caps anonymous submissions with expiry and validates the small contract', () => {
    const allow = createReportBudget();
    for (let n = 0; n < 5; n++) expect(allow('ip', 1000)).toBe(true);
    expect(allow('ip', 1000)).toBe(false);
    expect(allow('ip', 601001)).toBe(true);
    expect(PlaceReport.safeParse({ kind: 'no_beer' }).success).toBe(true);
    expect(PlaceReport.safeParse({ kind: 'delete', ip: 'unnecessary' }).success).toBe(false);
  });
});
