import type { MapStore, NearbyStore } from '@minimarket/shared';

type CardStore = MapStore | NearbyStore;

const CONFIDENCE_LABEL: Record<CardStore['confidence_level'], string> = {
  high: 'Alta probabilidad',
  medium: 'Probabilidad media',
  low: 'Probabilidad baja',
  excluded: 'Excluida',
};

const formatDistance = (m: number): string =>
  m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;

const hasDistance = (s: CardStore): s is NearbyStore =>
  'distance_m' in s && typeof (s as NearbyStore).distance_m === 'number';

export function StoreCard({
  store,
  onClose,
}: {
  store: CardStore;
  onClose: () => void;
}) {
  const distanceLabel = hasDistance(store) ? formatDistance(store.distance_m) : null;

  return (
    <div className="store-card">
      <button type="button" className="close-btn" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      <h2>{store.name}</h2>
      <div className="meta">
        {store.address ?? 'Dirección no disponible'}
        {distanceLabel ? ` · ${distanceLabel}` : ''}
      </div>
      <div className="meta">
        <strong>{CONFIDENCE_LABEL[store.confidence_level]}</strong>
        {store.neighbourhood ? ` · ${store.neighbourhood}` : ''}
      </div>
      <div className="badges">
        <span className={`badge ${store.confidence_level}`}>
          {CONFIDENCE_LABEL[store.confidence_level]}
        </span>
        {store.badges.map((b) => (
          <span key={b} className="badge">{b}</span>
        ))}
      </div>
    </div>
  );
}
