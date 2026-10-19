import type { NearbyStore } from '@cervezadonde/shared';
import {
  INTENT_COLOR,
  directionsUrl,
  displayName,
  intentOf,
  nearestLabel,
  subtitle,
  unverifiedNote,
} from './store-view.js';

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
  error,
  onRetry,
}: {
  store: NearbyStore | null;
  loading: boolean;
  onSelect: (s: NearbyStore) => void;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return <div className="nearest nearest--muted">Buscando la cerveza abierta más cercana…</div>;
  }
  if (error) {
    return (
      <div className="nearest nearest--muted" role="alert">
        {error}{' '}
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  }
  if (
    !store ||
    !store.open_now.sells_beer_now ||
    ['estimated', 'none'].includes(store.open_now.hours_source)
  ) {
    return (
      <div className="nearest nearest--muted">
        No encontramos opciones con horario de apertura disponible a menos de 3 km con estos
        filtros. Puede haber otros locales: consulta los puntos sin horario en el mapa.
      </div>
    );
  }

  const intent = intentOf(store);
  const unverified = unverifiedNote(store);
  return (
    <div className="nearest">
      <button type="button" className="nearest__main" onClick={() => onSelect(store)}>
        <span className="nearest__eyebrow">🍺 {nearestLabel(store)}</span>
        <span className="nearest__name">
          <span className="dot" style={{ background: INTENT_COLOR[intent] }} aria-hidden />
          {displayName(store)}
        </span>
        <span className="nearest__meta">
          {subtitle(store)} · {formatDistance(store.distance_m)}
          {store.open_now.closes_at
            ? ` · ${store.open_now.hours_source === 'estimated' ? 'suele cerrar a las' : 'hasta las'} ${store.open_now.closes_at}`
            : ''}
          {store.open_now.hours_source === 'estimated' ? ' · horario estimado' : ''}
          {store.open_now.sale_policy === 'unknown' ? ' · venta para llevar por confirmar' : ''}
        </span>
        {unverified ? <span className="nearest__unverified">⚠️ {unverified}</span> : null}
      </button>
      <a
        className="nearest__go"
        href={directionsUrl(store)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Cómo llegar a ${displayName(store)}`}
      >
        🧭
      </a>
    </div>
  );
}
