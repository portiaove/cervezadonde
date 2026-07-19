import type { NearbyStore } from '@cervezadonde/shared';
import { INTENT_COLOR, directionsUrl, intentOf, subtitle, unverifiedNote } from './store-view.js';

const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

/**
 * The "Ambos" banner: alongside the full map, always surface the single
 * nearest place that can serve/sell a beer right now from the user's location.
 */
export function NearestOpenCard({
  store,
  loading,
  onSelect,
}: {
  store: NearbyStore | null;
  loading: boolean;
  onSelect: (s: NearbyStore) => void;
}) {
  if (loading) {
    return <div className="nearest nearest--muted">Buscando la cerveza abierta más cercana…</div>;
  }
  if (!store) {
    return (
      <div className="nearest nearest--muted">
        No hay cerveza abierta a menos de 3 km. Prueba a mover el mapa.
      </div>
    );
  }

  const intent = intentOf(store);
  const unverified = unverifiedNote(store);
  return (
    <div className="nearest">
      <button type="button" className="nearest__main" onClick={() => onSelect(store)}>
        <span className="nearest__eyebrow">🍺 La más cercana abierta</span>
        <span className="nearest__name">
          <span className="dot" style={{ background: INTENT_COLOR[intent] }} aria-hidden />
          {store.name}
        </span>
        <span className="nearest__meta">
          {subtitle(store)} · {formatDistance(store.distance_m)}
          {store.open_now.closes_at ? ` · hasta las ${store.open_now.closes_at}` : ''}
          {store.open_now.hours_source === 'estimated' ? ' · horario estimado' : ''}
        </span>
        {unverified ? <span className="nearest__unverified">⚠️ {unverified}</span> : null}
      </button>
      <a
        className="nearest__go"
        href={directionsUrl(store)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Cómo llegar a ${store.name}`}
      >
        🧭
      </a>
    </div>
  );
}
