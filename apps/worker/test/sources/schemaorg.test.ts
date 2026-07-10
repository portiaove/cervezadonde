import { describe, expect, it } from 'vitest';
import { extractJsonLd, findHoursSpecs, hoursFromHtml } from '../../src/sources/schemaorg.js';

const page = (ld: unknown): string =>
  `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body/></html>`;

const restaurant = (spec: unknown) => ({
  '@context': 'https://schema.org',
  '@type': 'Restaurant',
  name: 'Bar Manolo',
  openingHoursSpecification: spec,
});

describe('extractJsonLd', () => {
  it('reads multiple blocks and survives a malformed one', () => {
    const html = `
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      <script type="application/ld+json">{oops not json</script>
      <script type='application/ld+json'>{"@type":"Restaurant"}</script>`;
    expect(extractJsonLd(html)).toHaveLength(2);
  });
});

describe('hoursFromHtml — OpeningHoursSpecification', () => {
  it('converts day-URL specs and merges consecutive days', () => {
    const html = page(
      restaurant([
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: [
            'https://schema.org/Monday',
            'https://schema.org/Tuesday',
            'https://schema.org/Wednesday',
          ],
          opens: '09:00',
          closes: '20:00',
        },
      ]),
    );
    expect(hoursFromHtml(html)).toBe('Mo-We 09:00-20:00');
  });

  it('keeps split shifts on one day', () => {
    const html = page(
      restaurant([
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: 'Saturday',
          opens: '10:00',
          closes: '14:00',
        },
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: 'Saturday',
          opens: '17:00',
          closes: '21:00',
        },
      ]),
    );
    expect(hoursFromHtml(html)).toBe('Sa 10:00-14:00,17:00-21:00');
  });

  it('maps a midnight close to 24:00', () => {
    const html = page(
      restaurant({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: 'Friday',
        opens: '12:00',
        closes: '00:00',
      }),
    );
    expect(hoursFromHtml(html)).toBe('Fr 12:00-24:00');
  });

  it('finds specs inside @graph', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite' },
        restaurant({ dayOfWeek: 'Sunday', opens: '11:00', closes: '16:00' }),
      ],
    });
    expect(hoursFromHtml(html)).toBe('Su 11:00-16:00');
  });

  it('normalises 9:00 and 09:00:00 time shapes', () => {
    const html = page(restaurant({ dayOfWeek: 'Monday', opens: '9:00', closes: '20:00:00' }));
    expect(hoursFromHtml(html)).toBe('Mo 09:00-20:00');
  });
});

describe('hoursFromHtml — openingHours shorthand', () => {
  it('accepts the near-OSM string form', () => {
    const html = page({ '@type': 'Store', openingHours: ['Mo-Sa 11:00-14:30', 'Su 12:00-15:00'] });
    expect(hoursFromHtml(html)).toBe('Mo-Sa 11:00-14:30; Su 12:00-15:00');
  });

  it('expands comma day lists', () => {
    const html = page({ '@type': 'Store', openingHours: 'Tu,Th 16:00-20:00' });
    expect(hoursFromHtml(html)).toBe('Tu 16:00-20:00; Th 16:00-20:00');
  });
});

describe('hoursFromHtml — rejects junk', () => {
  it('no JSON-LD → null', () => {
    expect(hoursFromHtml('<html><body>hola</body></html>')).toBeNull();
  });

  it('specs without days or with equal open/close → null', () => {
    expect(hoursFromHtml(page(restaurant({ opens: '09:00', closes: '20:00' })))).toBeNull();
    expect(
      hoursFromHtml(page(restaurant({ dayOfWeek: 'Monday', opens: '09:00', closes: '09:00' }))),
    ).toBeNull();
  });

  it('nonsense times → null', () => {
    expect(
      hoursFromHtml(page(restaurant({ dayOfWeek: 'Monday', opens: '25:99', closes: 'closed' }))),
    ).toBeNull();
  });
});

describe('findHoursSpecs', () => {
  it('collects from multiple nodes', () => {
    const html = page({
      '@graph': [
        restaurant({ dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }),
        { '@type': 'BarOrPub', openingHours: 'Fr-Sa 18:00-2:00' },
      ],
    });
    expect(findHoursSpecs(html)).toHaveLength(2);
  });
});
