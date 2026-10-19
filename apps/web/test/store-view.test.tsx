import type { NearbyStore } from '@cervezadonde/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeChip } from '../src/Controls.js';
import { NearestOpenCard } from '../src/NearestOpenCard.js';
import { StoreCard } from '../src/StoreCard.js';
import { displayName, statusOf } from '../src/store-view.js';

const store = {
  id: '1',
  name: '  ',
  place_type: 'bar',
  sells_onsite_beer: true,
  sells_takeaway_beer: false,
  lat: 40.4,
  lng: -3.7,
  distance_m: 100,
  address: null,
  neighbourhood: null,
  verification: 'mapped',
  open_now: {
    open: true,
    sells_beer_now: true,
    hours_source: 'estimated',
    closes_at: '01:00',
    reason: 'Horario habitual.',
  },
} as NearbyStore;

describe('truthful place labels', () => {
  it('gives unnamed places a functional fallback without inventing a business name', () => {
    expect(displayName(store)).toBe('Bar sin nombre');
    expect(renderToStaticMarkup(<StoreCard store={store} onClose={() => {}} />)).toContain(
      'Bar sin nombre',
    );
  });

  it('does not turn estimated closure into a confirmed closure', () => {
    const closed = {
      ...store,
      open_now: { ...store.open_now, open: false, sells_beer_now: false },
    };
    expect(statusOf(closed)).toBe('estimated_closed');
    expect(renderToStaticMarkup(<StoreCard store={closed} onClose={() => {}} />)).toContain(
      'Suele estar cerrado',
    );
  });

  it('qualifies the nearest result and closing time when the schedule is estimated', () => {
    const html = renderToStaticMarkup(
      <NearestOpenCard store={store} loading={false} onSelect={() => {}} />,
    );
    expect(html).toContain('suele estar abierta');
    expect(html).toContain('suele cerrar a las 01:00');
    expect(html).not.toContain('La más cercana abierta');
  });

  it('does not advertise a national sale permission from a Madrid time window', () => {
    const html = renderToStaticMarkup(
      <TimeChip now="2026-10-19T20:30:00Z" timeZone="Atlantic/Canary" />,
    );
    expect(html).toContain('21:30');
    expect(html).toContain('hora canaria');
    expect(html).not.toContain('venta para llevar');
  });
});
