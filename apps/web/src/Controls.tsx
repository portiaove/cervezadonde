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

export function FilterBar({
  filters,
  onChange,
}: {
  filters: UiFilters;
  onChange: (next: UiFilters) => void;
}) {
  const toggleIntent = (i: Intent) =>
    onChange({ ...filters, intent: filters.intent === i ? null : i });

  return (
    <div className="filter-bar">
      <button
        type="button"
        className={`chip ${filters.openNow ? 'chip--on' : ''}`}
        onClick={() => onChange({ ...filters, openNow: !filters.openNow })}
      >
        Abre ahora
      </button>
      <button
        type="button"
        className={`chip ${filters.intent === 'consume_aqui' ? 'chip--on' : ''}`}
        onClick={() => toggleIntent('consume_aqui')}
      >
        Para tomar
      </button>
      <button
        type="button"
        className={`chip ${filters.intent === 'para_llevar' ? 'chip--on' : ''}`}
        onClick={() => toggleIntent('para_llevar')}
      >
        Para llevar
      </button>
      <button
        type="button"
        className={`chip ${filters.hideChains ? 'chip--on' : ''}`}
        onClick={() => onChange({ ...filters, hideChains: !filters.hideChains })}
      >
        Ocultar cadenas
      </button>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
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
        <span>Cerrado / horario no confirmado</span>
      </div>
    </div>
  );
}
