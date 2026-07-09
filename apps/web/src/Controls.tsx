import type { Intent } from '@cervezadonde/shared';
import { INTENT_COLOR } from './store-view.js';

const madridTime = (iso: string): string =>
  new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export function TimeChip({
  now,
  takeawayAllowed,
}: {
  now: string | null;
  takeawayAllowed: boolean | null;
}) {
  if (!now) return null;
  const allowed = takeawayAllowed ?? true;
  return (
    <div className="time-chip">
      <span className="time-chip__clock">{madridTime(now)}</span>
      <span className={`time-chip__state ${allowed ? 'ok' : 'closed'}`}>
        {allowed ? 'venta para llevar abierta' : 'venta para llevar cerrada'}
      </span>
    </div>
  );
}

export type UiFilters = {
  openNow: boolean;
  intent: Intent | null;
  hideChains: boolean;
};

// The intent choices are mutually exclusive, so a segmented control (not
// scrolling chips) is the right widget: every option visible at once. The
// colour dots double as the legend for the marker colours.
const INTENT_SEGMENTS: Array<{
  value: Intent | null;
  label: string;
  title: string;
  dot?: string;
}> = [
  { value: null, label: 'Todo', title: 'Barra y lata' },
  {
    value: 'consume_aqui',
    label: 'Tomar',
    title: 'En barra — bar, cafetería',
    dot: INTENT_COLOR.barra,
  },
  {
    value: 'para_llevar',
    label: 'Llevar',
    title: 'En lata — súper, alimentación',
    dot: INTENT_COLOR.lata,
  },
];

function SlidersIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.6" fill="var(--panel)" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="15" cy="17" r="2.6" fill="var(--panel)" />
    </svg>
  );
}

/**
 * The one control surface: a thumb-reachable bottom bar with the intent
 * segmented control, the "Abre ahora" toggle, and the overflow-sheet trigger.
 */
export function BottomBar({
  filters,
  onChange,
  onMore,
}: {
  filters: UiFilters;
  onChange: (next: UiFilters) => void;
  onMore: () => void;
}) {
  return (
    <div className="bar">
      <div className="segmented" aria-label="Qué buscas">
        {INTENT_SEGMENTS.map((s) => (
          <button
            key={s.label}
            type="button"
            aria-pressed={filters.intent === s.value}
            title={s.title}
            className={`segmented__btn ${filters.intent === s.value ? 'segmented__btn--on' : ''}`}
            onClick={() => onChange({ ...filters, intent: s.value })}
          >
            {s.dot && <span className="dot dot--sm" style={{ background: s.dot }} aria-hidden />}
            {s.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`open-now ${filters.openNow ? 'open-now--on' : ''}`}
        aria-pressed={filters.openNow}
        onClick={() => onChange({ ...filters, openNow: !filters.openNow })}
      >
        Abre ahora
      </button>
      <button
        type="button"
        className="bar__more"
        onClick={onMore}
        aria-label="Más filtros y leyenda"
      >
        <SlidersIcon />
      </button>
    </div>
  );
}

/**
 * Overflow bottom sheet: secondary filter (hide chains), the full legend, and
 * the data-source note — everything that doesn't deserve to float on the map.
 */
export function MoreSheet({
  filters,
  onChange,
  onClose,
}: {
  filters: UiFilters;
  onChange: (next: UiFilters) => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet">
      <button type="button" className="sheet__scrim" onClick={onClose} aria-label="Cerrar" />
      <div className="sheet__panel" aria-label="Filtros y leyenda">
        <div className="sheet-handle" aria-hidden />

        <div className="sheet__title">Filtros</div>
        <button
          type="button"
          className="switch-row"
          aria-pressed={filters.hideChains}
          onClick={() => onChange({ ...filters, hideChains: !filters.hideChains })}
        >
          <span className="switch-row__text">
            Ocultar cadenas
            <small>Fuera supermercados y franquicias</small>
          </span>
          <span className={`switch ${filters.hideChains ? 'switch--on' : ''}`} aria-hidden>
            <span className="switch__knob" />
          </span>
        </button>

        <div className="sheet__title">Leyenda</div>
        <div className="legend__row">
          <span className="legend__dot" style={{ background: INTENT_COLOR.barra }} />
          <span>
            <strong>Barra</strong> — para tomar (bar, cafetería)
          </span>
        </div>
        <div className="legend__row">
          <span className="legend__dot" style={{ background: INTENT_COLOR.lata }} />
          <span>
            <strong>Lata</strong> — para llevar (súper, alimentación)
          </span>
        </div>
        <div className="legend__sep" />
        <div className="legend__row">
          <span className="legend__ring legend__ring--open" />
          <span>Puede venderte ahora</span>
        </div>
        <div className="legend__row">
          <span className="legend__ring legend__ring--faded" />
          <span>Cerrado o con horario no confirmado</span>
        </div>

        <div className="sheet__title">Datos</div>
        <p className="sheet__note">
          Locales del Ayuntamiento de Madrid y © OpenStreetMap; horarios de OSM.
        </p>

        <button type="button" className="sheet__done" onClick={onClose}>
          Listo
        </button>
      </div>
    </div>
  );
}

/**
 * Small top-center status pill: a spinner while the viewport loads, or an
 * empty-result hint (e.g. a filter cleared the map). Only one shows at a time.
 */
export function MapStatus({ loading, empty }: { loading: boolean; empty: boolean }) {
  if (loading) {
    return (
      <div className="map-status">
        <span className="map-status__spinner" aria-hidden />
        Buscando locales…
      </div>
    );
  }
  if (empty) {
    return (
      <div className="map-status">No hay locales por aquí — mueve el mapa o quita filtros</div>
    );
  }
  return null;
}
