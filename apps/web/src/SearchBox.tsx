import { useCallback, useEffect, useRef, useState } from 'react';

// Street/place search via Photon (komoot's OSM geocoder): free, keyless,
// CORS-enabled and explicitly built for as-you-type autocomplete (which
// Nominatim's usage policy forbids). Results are biased to the current map
// centre so "gran vía" finds the one you're looking at.
const PHOTON_URL = 'https://photon.komoot.io/api';

export type SearchPick = {
  lng: number;
  lat: number;
  /** [minLng, minLat, maxLng, maxLat] when Photon knows the extent. */
  bbox?: [number, number, number, number];
};

type Result = {
  label: string;
  detail: string;
  pick: SearchPick;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
};

const toResult = (f: PhotonFeature): Result | null => {
  const p = f.properties;
  const label = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ');
  if (!label) return null;
  const detail = [p.city, p.state].filter(Boolean).join(', ');
  const [lng, lat] = f.geometry.coordinates;
  // Photon extent is [minLng, maxLat, maxLng, minLat] — normalise it.
  const e = p.extent;
  const bbox: SearchPick['bbox'] = e
    ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])]
    : undefined;
  return { label, detail, pick: { lng, lat, bbox } };
};

export function SearchBox({
  getBias,
  onPick,
}: {
  /** Current map centre, used to rank nearby results first. */
  getBias: () => { lng: number; lat: number } | null;
  onPick: (pick: SearchPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSearched(false);
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runSearch = useCallback(
    (q: string) => {
      abortRef.current?.abort();
      const trimmed = q.trim();
      if (trimmed.length < 3) {
        setResults([]);
        setSearched(false);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const bias = getBias();
      // No lang param: Photon only supports default/de/en/fr, and "default"
      // returns local names — which for Spain are already the Spanish ones.
      const qs = new URLSearchParams({ q: trimmed, limit: '5' });
      if (bias) {
        qs.set('lat', bias.lat.toFixed(4));
        qs.set('lon', bias.lng.toFixed(4));
      }
      fetch(`${PHOTON_URL}?${qs.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .then((data: { features?: PhotonFeature[] }) => {
          setResults((data.features ?? []).map(toResult).filter((r): r is Result => r !== null));
          setSearched(true);
        })
        .catch(() => {
          /* aborted or offline — keep whatever is shown */
        });
    },
    [getBias],
  );

  const onChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="search-fab"
        onClick={() => setOpen(true)}
        aria-label="Buscar calle o lugar"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <line x1="15.5" y1="15.5" x2="21" y2="21" />
        </svg>
      </button>
    );
  }

  return (
    <div className="search">
      <div className="search__bar">
        <input
          ref={inputRef}
          className="search__input"
          type="search"
          enterKeyHint="search"
          placeholder="Calle, plaza, barrio…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter' && results[0]) {
              onPick(results[0].pick);
              close();
            }
          }}
          aria-label="Buscar calle o lugar"
        />
        <button
          type="button"
          className="search__close"
          onClick={close}
          aria-label="Cerrar búsqueda"
        >
          ×
        </button>
      </div>

      {results.length > 0 && (
        <div className="search__results">
          {results.map((r) => (
            <button
              key={`${r.pick.lng},${r.pick.lat},${r.label}`}
              type="button"
              className="search__result"
              onClick={() => {
                onPick(r.pick);
                close();
              }}
            >
              <span className="search__result-label">{r.label}</span>
              {r.detail && <span className="search__result-detail">{r.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {searched && results.length === 0 && query.trim().length >= 3 && (
        <div className="search__results">
          <div className="search__empty">Sin resultados</div>
        </div>
      )}
    </div>
  );
}
