import type { MapStore, NearbyStore } from '@cervezadonde/shared';
import { ReportPlace } from './ReportPlace.js';
import {
  type AnyStore,
  INTENT_COLOR,
  STATE_RING,
  directionsUrl,
  displayName,
  intentOf,
  statusOf,
  subtitle,
  unverifiedNote,
} from './store-view.js';

type CardStore = MapStore | NearbyStore;

const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

const hasDistance = (s: CardStore): s is NearbyStore =>
  'distance_m' in s && typeof (s as NearbyStore).distance_m === 'number';

const STATE_TEXT: Record<ReturnType<typeof statusOf>, string> = {
  open: 'Abierto según su horario',
  estimated: 'Suele estar abierto a esta hora',
  estimated_closed: 'Suele estar cerrado a esta hora',
  ordinance: 'Venta para llevar restringida según la regla general',
  closed: 'Cerrado según su horario',
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
        <h2>{displayName(store)}</h2>
      </div>

      <div className="meta">
        {subtitle(s)}
        {distanceLabel ? ` · ${distanceLabel}` : ''}
      </div>

      <div className={`status status--${state}`}>
        <strong>{STATE_TEXT[state]}</strong>
        {state === 'open' && closesAt ? ` · hasta las ${closesAt}` : ''}
        {state === 'estimated' && closesAt ? ` · suele cerrar a las ${closesAt}` : ''}
      </div>

      <div className="meta reason">{store.open_now.reason}</div>
      {store.quality && (
        <div className="meta quality-note">
          {store.quality.beer === 'documented'
            ? 'Cerveza indicada en OSM; no garantiza existencias.'
            : 'Cerveza probable por el tipo de local, no verificada.'}
          <br />
          Horario:{' '}
          {store.open_now.hours_source === 'osm'
            ? 'OpenStreetMap'
            : store.open_now.hours_source === 'website'
              ? 'web del local'
              : store.open_now.hours_source === 'reviewed'
                ? 'corrección revisada'
                : 'desconocido'}
          .
          {store.quality.hours_source_url && (
            <>
              {' '}
              <a href={store.quality.hours_source_url} target="_blank" rel="noreferrer">
                Ver fuente
              </a>
              .
            </>
          )}
          {store.quality.osm_updated_at && (
            <>
              {' '}
              Última edición del objeto OSM:{' '}
              {new Date(store.quality.osm_updated_at).toLocaleDateString('es-ES')}; no es una
              visita.
            </>
          )}
        </div>
      )}

      {unverifiedNote(store) ? (
        <div className="unverified-note">
          ⚠️ {unverifiedNote(store)}. Puede que ya no exista — si lo conoces, compruébalo antes de
          ir.
        </div>
      ) : null}

      <div className="meta">
        {store.address ?? 'Dirección no disponible'}
        {store.neighbourhood ? ` · ${store.neighbourhood}` : ''}
      </div>

      <a className="cta-directions" href={directionsUrl(store)} target="_blank" rel="noreferrer">
        <span aria-hidden>🧭</span> Cómo llegar
      </a>
      <ReportPlace key={store.id} id={store.id} />
    </div>
  );
}
