import type { MapStore, NearbyStore } from '@cervezadonde/shared';
import {
  type AnyStore,
  INTENT_COLOR,
  STATE_RING,
  directionsUrl,
  intentOf,
  statusOf,
  subtitle,
} from './store-view.js';

type CardStore = MapStore | NearbyStore;

const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

const hasDistance = (s: CardStore): s is NearbyStore =>
  'distance_m' in s && typeof (s as NearbyStore).distance_m === 'number';

const STATE_TEXT: Record<ReturnType<typeof statusOf>, string> = {
  open: 'Puede servirte cerveza ahora',
  ordinance: 'Abierto, pero no puede vender para llevar ahora',
  closed: 'Cerrado ahora',
  unconfirmed: 'Horario no confirmado',
};

export function StoreCard({
  store,
  onClose,
}: {
  store: CardStore;
  onClose: () => void;
}) {
  const s = store as AnyStore;
  const state = statusOf(s);
  const intent = intentOf(s);
  const distanceLabel = hasDistance(store) ? formatDistance(store.distance_m) : null;
  const closesAt = store.open_now.closes_at;

  return (
    <div className="store-card">
      <div className="sheet-handle" aria-hidden />
      <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      <div className="store-card__head">
        <span
          className="dot"
          style={{ background: INTENT_COLOR[intent], borderColor: STATE_RING[state] }}
          aria-hidden
        />
        <h2>{store.name}</h2>
      </div>

      <div className="meta">
        {subtitle(s)}
        {distanceLabel ? ` · ${distanceLabel}` : ''}
      </div>

      <div className={`status status--${state}`}>
        <strong>{STATE_TEXT[state]}</strong>
        {state === 'open' && closesAt ? ` · hasta las ${closesAt}` : ''}
      </div>

      <div className="meta reason">{store.open_now.reason}</div>

      <div className="meta">
        {store.address ?? 'Dirección no disponible'}
        {store.neighbourhood ? ` · ${store.neighbourhood}` : ''}
      </div>

      <a className="cta-directions" href={directionsUrl(store)} target="_blank" rel="noreferrer">
        <span aria-hidden>🧭</span> Cómo llegar
      </a>
    </div>
  );
}
