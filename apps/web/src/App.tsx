import type { MapStore, NearbyStore, Ordinance } from '@cervezadonde/shared';
import type { StyleSpecification } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  Layer,
  type MapRef,
  Marker,
  Source,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FilterBar, Legend, TimeChip, type UiFilters } from './Controls.js';
import { NearestOpenCard } from './NearestOpenCard.js';
import { StoreCard } from './StoreCard.js';
import { type Filters, fetchMap, fetchNearby } from './api.js';
import { INTENT_COLOR, STATE_RING, intentOf, statusOf } from './store-view.js';

const MADRID_CENTER = { lat: 40.4168, lng: -3.7038 };

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

const markersToGeoJson = (stores: MapStore[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: stores.map((s) => ({
    type: 'Feature',
    id: s.id,
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: {
      id: s.id,
      intent: intentOf(s),
      state: statusOf(s),
    },
  })),
});

const toApiFilters = (f: UiFilters): Filters => ({
  open_now: f.openNow,
  intent: f.intent ?? undefined,
  hide_chains: f.hideChains,
});

export function App() {
  const mapRef = useRef<MapRef | null>(null);
  const [stores, setStores] = useState<MapStore[]>([]);
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

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refreshFromMap = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    try {
      const res = await fetchMap(
        { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        toApiFilters(filtersRef.current),
      );
      setStores(res.results);
      setNow(res.now);
      setOrdinance(res.ordinance);
    } catch (err) {
      console.error('fetchMap failed:', err);
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

  const data = useMemo(() => markersToGeoJson(stores), [stores]);

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
        interactiveLayerIds={['stores']}
        onClick={(e) => {
          const feature = e.features?.[0];
          const id = feature?.properties?.id as string | undefined;
          const match = id ? stores.find((s) => s.id === id) : null;
          setSelected(match ?? null);
        }}
      >
        <Source id="stores" type="geojson" data={data}>
          <Layer
            id="stores"
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
        Cerca de mí
      </button>

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
