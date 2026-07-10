import { describe, expect, it } from 'vitest';
import {
  type BcnRow,
  bcnDisplayName,
  classifyBcnPremise,
  composeBcnAddress,
} from '../../src/sources/barcelona.js';

const classify = (over: Partial<Parameters<typeof classifyBcnPremise>[0]> = {}) =>
  classifyBcnPremise({
    activityCode: '1400001',
    name: 'BAR MANOLO',
    open24h: false,
    degustacio: false,
    chainPatterns: [],
    ...over,
  });

describe('classifyBcnPremise', () => {
  it('maps bars to bar with onsite beer only', () => {
    const c = classify();
    expect(c?.placeType).toBe('bar');
    expect(c?.sellsOnsiteBeer).toBe(true);
    expect(c?.sellsTakeawayBeer).toBe(false);
    expect(c?.level).toBe('high');
  });

  it('maps supermarkets to takeaway', () => {
    const c = classify({ activityCode: '1000020', name: 'CONDIS' });
    expect(c?.placeType).toBe('supermercado');
    expect(c?.sellsTakeawayBeer).toBe(true);
    expect(c?.sellsOnsiteBeer).toBe(false);
  });

  it('maps drink shops (Begudes) to bodega', () => {
    expect(classify({ activityCode: '1001000' })?.placeType).toBe('bodega');
  });

  it('upgrades 24h shops to tienda_24h, but never bars', () => {
    expect(classify({ activityCode: '1000020', open24h: true })?.placeType).toBe('tienda_24h');
    expect(classify({ activityCode: '1400001', open24h: true })?.placeType).toBe('bar');
  });

  it('degustació grants onsite beer to shops', () => {
    const c = classify({ activityCode: '1001000', degustacio: true });
    expect(c?.sellsOnsiteBeer).toBe(true);
    expect(c?.sellsTakeawayBeer).toBe(true);
  });

  it('returns null for non-beer activities (offices, empty premises)', () => {
    expect(classify({ activityCode: '1600400' })).toBeNull();
    expect(classify({ activityCode: '30' })).toBeNull();
    expect(classify({ activityCode: '' })).toBeNull();
  });

  it('detects chains via the shared pattern matcher', () => {
    const c = classify({
      activityCode: '1000020',
      name: 'MERCADONA GRAN VIA',
      chainPatterns: ['MERCADONA'],
    });
    expect(c?.isChain).toBe(true);
  });

  it('always carries horario_no_confirmado (census has no hours)', () => {
    expect(classify()?.badges).toContain('horario_no_confirmado');
  });
});

const row = (over: Partial<BcnRow>): BcnRow =>
  ({
    ID_Global: 'x',
    Codi_Activitat_2022: '1400001',
    Nom_Activitat: 'Bars',
    Nom_Local: 'BAR MANOLO',
    SN_Obert24h: 'No',
    SN_Servei_Degustacio: 'No',
    Latitud: '41.38',
    Longitud: '2.17',
    Nom_Via: '',
    Num_Policia_Inicial: '',
    Lletra_Inicial: '',
    Num_Policia_Final: '',
    Lletra_Final: '',
    Nom_Barri: '',
    Nom_Districte: '',
    ...over,
  }) as BcnRow;

describe('composeBcnAddress', () => {
  it('composes street + number range', () => {
    expect(
      composeBcnAddress(
        row({ Nom_Via: 'GAIARRE', Num_Policia_Inicial: '84', Num_Policia_Final: '88' }),
      ),
    ).toBe('GAIARRE 84-88');
  });

  it('collapses identical first/last numbers', () => {
    expect(
      composeBcnAddress(
        row({ Nom_Via: 'AV PARAL·LEL', Num_Policia_Inicial: '87', Num_Policia_Final: '87' }),
      ),
    ).toBe('AV PARAL·LEL 87');
  });

  it('returns null without a street', () => {
    expect(composeBcnAddress(row({}))).toBeNull();
  });
});

describe('bcnDisplayName', () => {
  it('keeps the premise name', () => {
    expect(bcnDisplayName(row({}))).toBe('BAR MANOLO');
  });

  it("falls back to the activity label for 'SN' (sense nom)", () => {
    expect(bcnDisplayName(row({ Nom_Local: 'SN' }))).toBe('Bars');
    expect(bcnDisplayName(row({ Nom_Local: ' ' }))).toBe('Bars');
  });
});
