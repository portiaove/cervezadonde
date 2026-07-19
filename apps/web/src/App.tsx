import type { Cluster, MapStore, NearbyStore, Ordinance } from '@cervezadonde/shared';
import type { StyleSpecification } from 'maplibre-gl';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  AttributionControl,
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
  Marker,
  Source,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BottomBar, MapStatus, MoreSheet, TimeChip, type UiFilters } from './Controls.js';
import { NearestOpenCard } from './NearestOpenCard.js';
import { SearchBox, type SearchPick } from './SearchBox.js';
import { StoreCard } from './StoreCard.js';
import {
  type Filters,
  type MetaResponse,
  fetchClusters,
  fetchGeo,
  fetchMap,
  fetchMeta,
  fetchNearby,
} from './api.js';
import { INTENT_COLOR, STATE_RING, intentOf, statusOf } from './store-view.js';

type InitialViewState = NonNullable<ComponentProps<typeof MapGL>['initialViewState']>;

// The map opens roughly on the visitor's city (IP geolocation via /api/geo).
// IP geo is city-level, so a slightly wider zoom shows the whole area rather
// than an exact-but-approximate street.
const IP_ZOOM = 12;

// Fallback for visitors OUTSIDE Spain (or IPs without a city): frame the whole
// country instead of dropping them in Manila or an arbitrary Madrid street.
// Bounds (peninsula + Baleares) + fitBounds adapts to any viewport; Canarias is
// left out on purpose — including it would zoom out over the Atlantic and shrink
// the mainland to nothing (a visitor actually in Canarias gets their city by IP).
const SPAIN_VIEW = {
  bounds: [
    [-9.5, 35.9],
    [4.5, 43.9],
  ] as [[number, number], [number, number]],
  fitBoundsOptions: { padding: 24 },
};

// Don't let a slow/failed /geo call block first paint — fall back after this.
const GEO_TIMEOUT_MS = 1200;

// At or below this zoom the map shows server-aggregated count bubbles; above
// it, individual coloured markers (the product's core view).
const CLUSTER_MAX_ZOOM = 11;

// Muted basemap (Carto Positron raster, free with attribution): no built-in
// POI icons, so our coloured markers are the only "content" on the map —
// the standard OSM style's shop symbols competed with them. @2x tiles at
// tileSize 256 render crisp on retina screens.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: ['a', 'b', 'c', 'd'].map(
        (s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`,
      ),
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'basemap-tiles', type: 'raster', source: 'basemap' }],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const fmtCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n);

// Bubble diameter (px) grows with the aggregated count.
const bubbleSize = (n: number): number => (n >= 2000 ? 58 : n >= 500 ? 50 : n >= 50 ? 42 : 34);

const pointsToGeoJson = (stores: MapStore[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: stores.map((s) => ({
    type: 'Feature',
    id: s.id,
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: { id: s.id, intent: intentOf(s), state: statusOf(s), verification: s.verification },
  })),
});

const toApiFilters = (f: UiFilters): Filters => ({
  open_now: f.openNow,
  intent: f.intent ?? undefined,
  hide_chains: f.hideChains,
});

export function App() {
  const mapRef = useRef<MapRef | null>(null);
  const [points, setPoints] = useState<MapStore[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selected, setSelected] = useState<MapStore | null>(null);
  const [filters, setFilters] = useState<UiFilters>({
    openNow: false,
    intent: null,
    hideChains: false,
  });
  const [now, setNow] = useState<string | null>(null);
  const [ordinance, setOrdinance] = useState<Ordinance | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [nearest, setNearest] = useState<NearbyStore | null>(null);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  // Initial map view, resolved from IP geolocation before the map mounts so
  // there's no visible jump. A known Spanish city → {longitude,latitude,zoom};
  // anyone else → SPAIN_VIEW (bounds). null → still deciding (brief).
  const [initialView, setInitialView] = useState<InitialViewState | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Pick the opening view once, from /api/geo, racing a short timeout so a slow
  // API can never hold up first paint. A Spanish city centres there; everyone
  // else (abroad, VPN, unknown, timeout, error) gets the whole-Spain view.
  useEffect(() => {
    let settled = false;
    const settle = (view: InitialViewState) => {
      if (settled) return;
      settled = true;
      setInitialView(view);
    };
    const timer = setTimeout(() => settle(SPAIN_VIEW), GEO_TIMEOUT_MS);
    fetchGeo()
      .then((g) => {
        if (g.source === 'ip' && g.lat != null && g.lng != null) {
          settle({ longitude: g.lng, latitude: g.lat, zoom: IP_ZOOM });
        } else {
          settle(SPAIN_VIEW);
        }
      })
      .catch(() => settle(SPAIN_VIEW))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  const refreshFromMap = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bounds = {
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    };
    const z = map.getZoom();
    setLoading(true);
    try {
      if (z > CLUSTER_MAX_ZOOM) {
        // Zoomed in: individual coloured markers.
        const res = await fetchMap(bounds, toApiFilters(filtersRef.current));
        setPoints(res.results);
        setClusters([]);
        setNow(res.now);
        setOrdinance(res.ordinance);
      } else {
        // Wide zoom: server-aggregated count bubbles. Cell ≈ 64px wide.
        const widthDeg = Math.abs(bounds.east - bounds.west);
        const widthPx = map.getContainer().clientWidth || 400;
        const cell = clamp((widthDeg / widthPx) * 64, 0.0005, 20);
        const res = await fetchClusters(bounds, cell, toApiFilters(filtersRef.current));
        setClusters(res.clusters);
        setPoints([]);
      }
    } catch (err) {
      console.error('map refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNearest = useCallback(async (loc: { lat: number; lng: number }) => {
    setNearestLoading(true);
    try {
      const res = await fetchNearby(
        { lat: loc.lat, lng: loc.lng, radius_m: 3000, limit: 1 },
        { ...toApiFilters(filtersRef.current), open_now: true },
      );
      setNearest(res.results[0] ?? null);
    } catch (err) {
      console.error('fetchNearby failed:', err);
      setNearest(null);
    } finally {
      setNearestLoading(false);
    }
  }, []);

  // Dataset freshness + size, fetched once (shown in the "Datos" sheet).
  useEffect(() => {
    fetchMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  // Re-query whenever filters change (viewport + nearest).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh fns are stable
  useEffect(() => {
    void refreshFromMap();
    if (userLoc) void refreshNearest(userLoc);
  }, [filters, userLoc]);

  const onLoad = useCallback(() => {
    if (import.meta.env.DEV) {
      // Dev-only handle for browser automation; stripped from prod builds.
      (window as unknown as { __MAP__?: unknown }).__MAP__ = mapRef.current?.getMap();
    }
    // MapLibre mounts the compact attribution expanded (<details open>), which
    // covers the time chip; collapse it — it stays reachable behind the ⓘ.
    mapRef.current
      ?.getContainer()
      .querySelector('details.maplibregl-ctrl-attrib')
      ?.removeAttribute('open');
    void refreshFromMap();
  }, [refreshFromMap]);

  const onMoveEnd = useCallback(
    (_e: ViewStateChangeEvent) => {
      void refreshFromMap();
    },
    [refreshFromMap],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(loc);
        mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
        void refreshNearest(loc);
      },
      (err) => console.warn('geolocation denied:', err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [refreshNearest]);

  const selectNearby = useCallback((s: NearbyStore) => {
    setSelected(s as unknown as MapStore);
    mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: 16 });
  }, []);

  const searchBias = useCallback(() => {
    const c = mapRef.current?.getCenter();
    return c ? { lng: c.lng, lat: c.lat } : null;
  }, []);

  const goToSearchPick = useCallback((pick: SearchPick) => {
    const map = mapRef.current;
    if (!map) return;
    if (pick.bbox) {
      map.fitBounds(
        [
          [pick.bbox[0], pick.bbox[1]],
          [pick.bbox[2], pick.bbox[3]],
        ],
        { padding: 60, maxZoom: 17, duration: 700 },
      );
    } else {
      map.flyTo({ center: [pick.lng, pick.lat], zoom: 16, duration: 700 });
    }
  }, []);

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Generous tap target: an 8 px circle is un-tappable on mobile, so look
      // for markers within a ±12 px box around the tap and take the closest.
      const map = mapRef.current;
      if (!map) return;
      const PAD = 12;
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - PAD, e.point.y - PAD],
          [e.point.x + PAD, e.point.y + PAD],
        ],
        { layers: ['unclustered-point'] },
      );
      if (feats.length === 0) {
        setSelected(null);
        return;
      }
      const nearest = feats.reduce((best, f) => {
        const dist = (f2: typeof f) => {
          const [lng, lat] = (f2.geometry as GeoJSON.Point).coordinates as [number, number];
          const p = map.project([lng, lat]);
          return (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
        };
        return dist(f) < dist(best) ? f : best;
      });
      const id = nearest.properties?.id as string | undefined;
      const match = id ? points.find((s) => s.id === id) : null;
      setSelected(match ?? null);
    },
    [points],
  );

  const zoomIntoCluster = useCallback((c: Cluster) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [c.lng, c.lat], zoom: Math.min(map.getZoom() + 3, 15), duration: 500 });
  }, []);

  const pointsData = useMemo(() => pointsToGeoJson(points), [points]);
  const empty = !loading && points.length === 0 && clusters.length === 0;

  // Hold the map until the opening centre is decided (a few hundred ms at most)
  // so it mounts directly on the visitor's city — no Madrid→city jump.
  if (!initialView) {
    return <div className="app app--booting" />;
  }

  return (
    <div className="app">
      <MapGL
        ref={(r) => {
          mapRef.current = r;
        }}
        initialViewState={initialView}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        onLoad={onLoad}
        onMoveEnd={onMoveEnd}
        interactiveLayerIds={['unclustered-point']}
        onClick={onMapClick}
      >
        {/* One compact attribution (top-right, out of everything's way) holds
            both the tile credit and our data-source note. */}
        <AttributionControl
          position="top-right"
          compact
          customAttribution="Locales: © OSM + censos oficiales (Madrid, BCN, DIBA, Andalucía)"
        />
        {/* Individual coloured markers (zoomed in) — the product's core view. */}
        <Source id="points" type="geojson" data={pointsData}>
          <Layer
            id="unclustered-point"
            type="circle"
            paint={{
              // 'unverified' (censo-only, not in OSM — see docs/16) renders as a
              // HOLLOW marker: white centre, intent-coloured outline. Distinct
              // from the faded "closed" look (unverified ≠ closed). When such a
              // place is closed right now, the closed treatment wins (night maps
              // shouldn't highlight it), hence the `!= closed` guard.
              'circle-radius': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                6,
                ['match', ['get', 'state'], 'open', 8, 'estimated', 8, 6],
              ],
              'circle-color': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                '#ffffff',
                [
                  'match',
                  ['get', 'intent'],
                  'barra',
                  INTENT_COLOR.barra,
                  'lata',
                  INTENT_COLOR.lata,
                  INTENT_COLOR.otro,
                ],
              ],
              'circle-opacity': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                0.92,
                [
                  'match',
                  ['get', 'state'],
                  'open',
                  1,
                  'estimated',
                  0.95,
                  'ordinance',
                  0.9,
                  'unconfirmed',
                  0.5,
                  0.32,
                ],
              ],
              'circle-stroke-color': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                [
                  'match',
                  ['get', 'intent'],
                  'barra',
                  INTENT_COLOR.barra,
                  'lata',
                  INTENT_COLOR.lata,
                  INTENT_COLOR.otro,
                ],
                [
                  'match',
                  ['get', 'state'],
                  'open',
                  STATE_RING.open,
                  'estimated',
                  STATE_RING.estimated,
                  'ordinance',
                  STATE_RING.ordinance,
                  'unconfirmed',
                  STATE_RING.unconfirmed,
                  STATE_RING.closed,
                ],
              ],
              'circle-stroke-width': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                2,
                ['match', ['get', 'state'], 'open', 3, 'estimated', 2.5, 'ordinance', 2, 1],
              ],
              'circle-stroke-opacity': [
                'case',
                [
                  'all',
                  ['==', ['get', 'verification'], 'unverified'],
                  ['!=', ['get', 'state'], 'closed'],
                ],
                0.9,
                ['match', ['get', 'state'], 'open', 1, 'closed', 0.5, 0.85],
              ],
            }}
          />
        </Source>

        {/* Server-aggregated count bubbles (wide zoom) as DOM markers — no
            external glyph dependency, and clearer than map-drawn text. */}
        {clusters.map((c) => {
          const size = bubbleSize(c.count);
          return (
            <Marker key={`${c.lng},${c.lat}`} longitude={c.lng} latitude={c.lat} anchor="center">
              <button
                type="button"
                className="cluster-bubble"
                style={{ width: size, height: size }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  zoomIntoCluster(c);
                }}
              >
                {fmtCount(c.count)}
              </button>
            </Marker>
          );
        })}

        {userLoc && (
          <Marker longitude={userLoc.lng} latitude={userLoc.lat} anchor="center">
            <span className="user-dot" title="Tu ubicación" />
          </Marker>
        )}

        {nearest && (
          <Marker longitude={nearest.lng} latitude={nearest.lat} anchor="center">
            <span className="nearest-ring" title="La más cercana abierta" />
          </Marker>
        )}
      </MapGL>

      <div className="top-left">
        <TimeChip now={now} takeawayAllowed={ordinance?.takeaway_allowed ?? null} />
      </div>

      <SearchBox getBias={searchBias} onPick={goToSearchPick} />

      <MapStatus loading={loading} empty={empty} />

      {/* Bottom-anchored column: FAB, nearest-open card and the control bar
          stack naturally without manual offsets. */}
      <div className="bottom-ui">
        <div className="bottom-ui__fabrow">
          <button type="button" className="fab" onClick={locate}>
            <span aria-hidden>📍</span> Cerca de mí
          </button>
        </div>
        {userLoc && (
          <NearestOpenCard store={nearest} loading={nearestLoading} onSelect={selectNearby} />
        )}
        <BottomBar filters={filters} onChange={setFilters} onMore={() => setSheetOpen(true)} />
      </div>

      {sheetOpen && (
        <MoreSheet
          filters={filters}
          onChange={setFilters}
          onClose={() => setSheetOpen(false)}
          meta={meta}
        />
      )}

      {selected && <StoreCard store={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
