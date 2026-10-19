import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHoursSource, isSkippedHoursUrl } from '../src/crawl-hours.js';

afterEach(() => vi.unstubAllGlobals());

describe('hours-source policy', () => {
  it('excludes Google Maps country domains and shared links without excluding business Google Sites', () => {
    for (const url of [
      'https://www.google.es/maps/place/test',
      'https://maps.google.co.uk/test',
      'https://maps.app.goo.gl/example',
      'https://www.google.com/maps',
      'file:///tmp/test',
    ]) {
      expect(isSkippedHoursUrl(url)).toBe(true);
    }
    expect(isSkippedHoursUrl('https://sites.google.com/view/example-business')).toBe(false);
  });

  it('does not follow an otherwise valid business URL into a Google Maps redirect', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://www.google.es/maps/place/test' },
        }),
      );
    vi.stubGlobal('fetch', request);
    expect(await fetchHoursSource('https://example.com/business', 5000)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows a normal relative business-site redirect', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/hours' } }))
      .mockResolvedValueOnce(new Response('Hours', { status: 200 }));
    vi.stubGlobal('fetch', request);
    expect((await fetchHoursSource('https://example.com/business', 5000))?.status).toBe(200);
    expect(request.mock.calls[1][0]).toBe('https://example.com/hours');
  });
});
