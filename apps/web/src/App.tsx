import type { Cluster, MapStore, NearbyStore, Ordinance } from '@cervezadonde/shared';
import type { StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
  Marker,
  Source,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FilterBar, Legend, MapStatus, TimeChip, type UiFilters } from './Controls.js';
import { NearestOpenCard } from './NearestOpenCard.js';
import { StoreCard } from './StoreCard.js';
import { type Filters, fetchClusters, fetchMap, fetchNearby } from './api.js';
import { INTENT_COLOR, STATE_RING, intentOf, statusOf } from './store-view.js';

const MADRID_CENTER = { lat: 40.4168, lng: -3.7038 };

// At or below this zoom the map shows server-aggregated count bubbles; above
// it, individual coloured markers (the product's core view).
const CLUSTER_MAX_ZOOM = 11;

// Dev tile source: OpenStreetMap raster tiles. Free, no API key.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
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
    properties: { id: s.id, intent: intentOf(s), state: statusOf(s) },
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

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

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

  // Re-query whenever filters change (viewport + nearest).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh fns are stable
  useEffect(() => {
    void refreshFromMap();
    if (userLoc) void refreshNearest(userLoc);
  }, [filters, userLoc]);

  const onLoad = useCallback(() => {
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

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) {
        setSelected(null);
        return;
      }
      const id = feature.properties?.id as string | undefined;
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

  return (
    <div className="app">
      <MapGL
        ref={(r) => {
          mapRef.current = r;
        }}
        initialViewState={{
          latitude: MADRID_CENTER.lat,
          longitude: MADRID_CENTER.lng,
          zoom: 13,
        }}
        mapStyle={MAP_STYLE}
        onLoad={onLoad}
        onMoveEnd={onMoveEnd}
        interactiveLayerIds={['unclustered-point']}
        onClick={onMapClick}
      >
        {/* Individual coloured markers (zoomed in) — the product's core view. */}
        <Source id="points" type="geojson" data={pointsData}>
          <Layer
            id="unclustered-point"
            type="circle"
            paint={{
              'circle-radius': ['match', ['get', 'state'], 'open', 7, 5],
              'circle-color': [
                'match',
                ['get', 'intent'],
                'barra',
                INTENT_COLOR.barra,
                'lata',
                INTENT_COLOR.lata,
                INTENT_COLOR.otro,
              ],
              'circle-opacity': [
                'match',
                ['get', 'state'],
                'open',
                1,
                'ordinance',
                0.9,
                'unconfirmed',
                0.5,
                0.32,
              ],
              'circle-stroke-color': [
                'match',
                ['get', 'state'],
                'open',
                STATE_RING.open,
                'ordinance',
                STATE_RING.ordinance,
                'unconfirmed',
                STATE_RING.unconfirmed,
                STATE_RING.closed,
              ],
              'circle-stroke-width': ['match', ['get', 'state'], 'open', 2.5, 'ordinance', 2, 1],
              'circle-stroke-opacity': ['match', ['get', 'state'], 'open', 1, 'closed', 0.5, 0.85],
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
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      <button type="button" className="locate-btn" onClick={locate}>
        <span aria-hidden>📍</span> Cerca de mí
      </button>

      <MapStatus loading={loading} empty={empty} />

      <Legend />

      {userLoc && (
        <NearestOpenCard store={nearest} loading={nearestLoading} onSelect={selectNearby} />
      )}

      <div className="attribution">
        Datos: Ayuntamiento de Madrid + © OpenStreetMap contributors. Horarios de OSM.
      </div>

      {selected && <StoreCard store={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
