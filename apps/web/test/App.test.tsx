import type { FeatureCollection } from 'geojson';
import type { ReactNode } from 'react';
import { type ReactTestRenderer, act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { BottomBar, MapStatus } from '../src/Controls.js';
import { fetchClusters, fetchGeo, fetchMap, fetchMeta } from '../src/api.js';

const harness = vi.hoisted(() => ({
  props: {} as {
    onLoad: () => void;
    onMoveEnd: (event: { viewState: Record<string, number> }) => void;
    onError: (event: { error: Error; sourceId?: string }) => void;
    mapStyle: { sources: { basemap: { tiles: string[] } } };
    children?: ReactNode;
  },
  zoom: 14,
}));

vi.mock('maplibre-gl', () => ({ default: {} }));
vi.mock('react-map-gl/maplibre', async () => {
  const React = await import('react');
  const map = {
    getBounds: () => ({
      getNorth: () => 41,
      getSouth: () => 40,
      getEast: () => -3,
      getWest: () => -4,
    }),
    getZoom: () => harness.zoom,
    getCenter: () => ({ lat: 40.4, lng: -3.7 }),
    getContainer: () => ({ clientWidth: 400, querySelector: () => null }),
    getMap: () => ({}),
  };
  return {
    default: React.forwardRef((props: typeof harness.props, ref) => {
      harness.props = props;
      React.useImperativeHandle(ref, () => map, []);
      return React.createElement('map-view', null, props.children);
    }),
    Source: (props: { children?: ReactNode }) =>
      React.createElement('map-source', props, props.children),
    Layer: () => null,
    Marker: (props: { children?: ReactNode }) =>
      React.createElement('map-marker', null, props.children),
    AttributionControl: (props: Record<string, unknown>) =>
      React.createElement('map-attribution', props),
  };
});

vi.mock('../src/api.js', () => ({
  fetchMap: vi.fn(),
  fetchClusters: vi.fn(),
  fetchGeo: vi.fn(),
  fetchMeta: vi.fn(),
  fetchNearby: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const response = (id: string) => ({
  now: '2026-10-19T12:00:00Z',
  ordinance: { takeaway_allowed: true, window: '' },
  results: [
    {
      id,
      lat: 40.4,
      lng: -3.7,
      name: id,
      sells_onsite_beer: true,
      verification: 'mapped',
      open_now: { open: true, sells_beer_now: true, hours_source: 'osm', reason: '' },
    },
  ],
});

let tree: ReactTestRenderer;

async function mount() {
  await act(async () => {
    tree = create(<App />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  harness.zoom = 14;
  vi.stubGlobal('window', { localStorage: { getItem: () => null }, location: { reload: vi.fn() } });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.mocked(fetchGeo).mockResolvedValue({ lat: 40.4, lng: -3.7, city: 'Madrid', source: 'ip' });
  vi.mocked(fetchMeta).mockResolvedValue({
    active_stores: 1,
    stores_with_hours: 1,
    data_updated_at: null,
  });
  vi.mocked(fetchMap).mockResolvedValue(response('current') as never);
  vi.mocked(fetchClusters).mockResolvedValue({ clusters: [] });
});

afterEach(() => {
  if (tree) act(() => tree.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('map lifecycle regressions', () => {
  it('boots even when reading localStorage throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage denied');
      },
    });
    await mount();
    expect(tree.root.findAllByType('map-view')).toHaveLength(1);
  });

  it('uses the regional fallback if geolocation never responds', async () => {
    vi.mocked(fetchGeo).mockReturnValue(new Promise(() => {}));
    await mount();
    expect(tree.root.findAllByType('map-view')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(tree.root.findAllByType('map-view')).toHaveLength(1);
  });

  it('does not let an older viewport overwrite the latest markers', async () => {
    const old = deferred<ReturnType<typeof response>>();
    const current = deferred<ReturnType<typeof response>>();
    vi.mocked(fetchMap).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await mount();
    await act(async () => {
      harness.props.onLoad();
    });
    const oldSignal = vi.mocked(fetchMap).mock.calls[0][3];
    await act(async () => {
      harness.props.onMoveEnd({ viewState: {} });
    });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      current.resolve(response('new'));
    });
    await act(async () => {
      old.resolve(response('old'));
    });
    const source = tree.root.findByType('map-source');
    expect((source.props.data as FeatureCollection).features.map((f) => f.id)).toEqual(['new']);
    expect(tree.root.findByType(MapStatus).props.loading).toBe(false);
  });

  it('reports a failed request instead of claiming there are no places', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchMap).mockRejectedValueOnce(new Error('offline'));
    await mount();
    await act(async () => {
      harness.props.onLoad();
    });
    expect(tree.root.findByType(MapStatus).props.error).toContain('conexión');
    expect(tree.root.findByType(MapStatus).props.empty).toBe(false);
    await act(async () => {
      tree.root.findByType(MapStatus).props.onRetry();
    });
    expect(tree.root.findByType(MapStatus).props.error).toBeNull();
  });

  it('filters actual points at wide zoom when open-now is enabled', async () => {
    harness.zoom = 9;
    await mount();
    await act(async () => {
      harness.props.onLoad();
    });
    expect(fetchClusters).toHaveBeenCalledTimes(1);
    await act(async () => {
      const bar = tree.root.findByType(BottomBar);
      bar.props.onChange({ ...bar.props.filters, openNow: true });
    });
    expect(fetchMap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ open_now: true }),
      2000,
      expect.anything(),
    );
    expect(fetchClusters).toHaveBeenCalledTimes(1);
  });

  it('refreshes an idle tab and aborts requests when it unmounts', async () => {
    await mount();
    await act(async () => {
      harness.props.onLoad();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMap).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(fetchMap).mock.calls[1][3];
    act(() => tree.unmount());
    expect(signal?.aborted).toBe(true);
  });

  it('starts directly with the key-free basemap, not CARTO HTTP-200 error tiles', async () => {
    await mount();
    expect(harness.props.mapStyle.sources.basemap.tiles).toEqual([
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ]);
    expect(JSON.stringify(harness.props.mapStyle)).not.toContain('cartocdn');
    expect(tree.root.findByType('map-attribution').props.compact).toBe(false);
    expect(JSON.stringify(harness.props.mapStyle)).toContain(
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('reports an unavailable basemap instead of silently leaving a blank background', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount();
    act(() => harness.props.onError({ error: new Error('tile unavailable'), sourceId: 'basemap' }));
    expect(tree.root.findByType(MapStatus).props.error).toContain('fondo del mapa');
  });

  it('reports a map that never finishes starting instead of spinning forever', async () => {
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(tree.root.findByType(MapStatus).props.error).toContain('iniciarse');
  });
});
