import { describe, expect, it } from 'vitest';
import {
  ANDALUCIA_CNAE_PLACE_TYPE,
  ANDALUCIA_WFS_URL,
  type AndaluciaProps,
  andaluciaDisplayName,
  classifyAndaluciaPremise,
} from '../../src/sources/andalucia.js';

const classify = (cnae: string, name = 'X', chainPatterns: string[] = []) =>
  classifyAndaluciaPremise({ cnae, name, chainPatterns });

describe('classifyAndaluciaPremise — CNAE lookup', () => {
  it('maps bars and restaurants to bar (onsite, not takeaway)', () => {
    for (const cnae of ['5630', '5610']) {
      const r = classify(cnae);
      expect(r?.placeType, cnae).toBe('bar');
      expect(r?.sellsOnsiteBeer).toBe(true);
      expect(r?.sellsTakeawayBeer).toBe(false);
      expect(r?.badges).toContain('vende_cerveza_in_situ');
      expect(r?.badges).toContain('horario_no_confirmado');
    }
  });

  it('maps supermarkets (takeaway, not onsite)', () => {
    const r = classify('4711');
    expect(r?.placeType).toBe('supermercado');
    expect(r?.sellsTakeawayBeer).toBe(true);
    expect(r?.sellsOnsiteBeer).toBe(false);
    expect(r?.badges).toContain('vende_cerveza_para_llevar');
  });

  it('maps drink shops to bodega', () => {
    expect(classify('4725')?.placeType).toBe('bodega');
  });

  it('maps specific food retail to alimentacion', () => {
    for (const cnae of ['4721', '4722', '4723', '4724', '4729']) {
      expect(classify(cnae)?.placeType, cnae).toBe('alimentacion');
    }
  });

  it('trims whitespace around the CNAE code', () => {
    expect(classify(' 5630 ')?.placeType).toBe('bar');
  });

  it('returns null for non-beer or unknown CNAE codes', () => {
    // 6209 IT services, 4939 transport, 8899 social work, 4730 fuel (OSM covers)
    for (const cnae of ['6209', '4939', '8899', '4730', '', '9999']) {
      expect(classify(cnae), cnae).toBeNull();
    }
  });

  it('detects chains from the name', () => {
    const r = classify('4711', 'MERCADONA', ['mercadona']);
    expect(r?.isChain).toBe(true);
    expect(classify('4711', 'CABRERA CORONILLA SL', ['mercadona'])?.isChain).toBe(false);
  });
});

describe('andaluciaDisplayName', () => {
  const props = (over: Partial<AndaluciaProps> = {}): AndaluciaProps => ({
    id: 3136437,
    razon_social: 'POP 92 SL',
    domicilio: 'AV KANSAS CITY S N',
    codpos: '41007',
    provincia: 'Sevilla',
    codmun: '41091',
    nombre_mun: 'Sevilla',
    cnae: '5630',
    actividad: 'Establecimientos de bebidas',
    sector_actividad: 'Hostelería',
    ...over,
  });

  it('uses the razón social when present', () => {
    expect(andaluciaDisplayName(props())).toBe('POP 92 SL');
  });

  it('falls back to the activity label when there is no name', () => {
    expect(andaluciaDisplayName(props({ razon_social: null }))).toBe('Establecimientos de bebidas');
    expect(andaluciaDisplayName(props({ razon_social: '  ' }))).toBe('Establecimientos de bebidas');
  });
});

describe('ANDALUCIA_WFS_URL', () => {
  it('filters on exactly the classifier CNAE codes (no drift)', () => {
    const url = decodeURIComponent(ANDALUCIA_WFS_URL);
    for (const code of Object.keys(ANDALUCIA_CNAE_PLACE_TYPE)) {
      expect(url, code).toContain(`'${code}'`);
    }
    expect(url).toContain('srsName=EPSG:4326');
    expect(url).toContain('estab_geo24');
  });
});
