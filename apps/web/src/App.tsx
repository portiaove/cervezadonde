import { useCallback, useMemo, useRef, useState } from 'react';
import Map, { Layer, Source, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import type { MapStore } from '@minimarket/shared';
import 'maplibre-gl/dist/maplibre-gl.css';
import { fetchMap } from './api.js';
import { StoreCard } from './StoreCard.js';

const MADRID_CENTER = { lat: 40.4168, lng: -3.7038 };

// Dev tile source: OpenStreetMap raster tiles. Free, no API key.
// For production we'll move to a vector provider (MapTiler / Stadia / Protomaps).
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
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm' },
  ],
};

const markersToGeoJson = (stores: MapStore[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: stores.map((s) => ({
    type: 'Feature',
    id: s.id,
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: {
      id: s.id,
      confidence_level: s.confidence_level,
    },
  })),
});

const refreshFromMap = async (
  map: MapRef,
  setStores: (s: MapStore[]) => void,
) => {
  const bounds = map.getBounds();
  try {
    const results = await fetchMap({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
      limit: 1000,
    });
    setStores(results);
  } catch (err) {
    console.error('fetchMap failed:', err);
  }
};

export function App() {
  const mapRef = useRef<MapRef | null>(null);
  const [stores, setStores] = useState<MapStore[]>([]);
  const [selected, setSelected] = useState<MapStore | null>(null);

  const onLoad = useCallback(() => {
    const map = mapRef.current;
    if (map) void refreshFromMap(map, setStores);
  }, []);

  const onMoveEnd = useCallback((_e: ViewStateChangeEvent) => {
    const map = mapRef.current;
    if (map) void refreshFromMap(map, setStores);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 15,
        });
      },
      (err) => console.warn('geolocation denied:', err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const data = useMemo(() => markersToGeoJson(stores), [stores]);

  return (
    <div className="app">
      <Map
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
          if (!feature) {
            setSelected(null);
            return;
          }
          const id = feature.properties?.id as string | undefined;
          const match = id ? stores.find((s) => s.id === id) : null;
          setSelected(match ?? null);
        }}
      >
        <Source id="stores" type="geojson" data={data}>
          <Layer
            id="stores"
            type="circle"
            paint={{
              'circle-radius': [
                'match',
                ['get', 'confidence_level'],
                'high', 7,
                'medium', 5,
                3,
              ],
              'circle-color': [
                'match',
                ['get', 'confidence_level'],
                'high', '#16a34a',
                'medium', '#ca8a04',
                '#6b7280',
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
            }}
          />
        </Source>
      </Map>

      <button type="button" className="locate-btn" onClick={locate}>
        Cerca de mí
      </button>

      <div className="attribution">
        Contiene información reutilizada del Portal de Datos Abiertos del Ayuntamiento de Madrid.
        Mapa base © OpenStreetMap contributors.
      </div>

      {selected && <StoreCard store={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
