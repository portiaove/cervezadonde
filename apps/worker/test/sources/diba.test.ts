import { describe, expect, it } from 'vitest';
import {
  type DibaRow,
  classifyDibaActivity,
  classifyDibaPremise,
  dibaDisplayName,
  dibaMunicipi,
} from '../../src/sources/diba.js';

describe('classifyDibaActivity — real GIA activity labels', () => {
  it('maps bars, restaurants and cafés (all spelling variants) to bar', () => {
    for (const a of [
      'BAR',
      'BAR RESTAURANT',
      'BAR-RESTAURANT',
      'RESTAURANT',
      'RESTAURANT BAR',
      'BAR - CAFETERIA',
      'BAR CAFETERIA',
      'Restaurant bar',
      'PIZZERIA',
      'RESTAURANTS I ESTABLIMENTS DE MENJAR',
    ]) {
      expect(classifyDibaActivity(a), a).toBe('bar');
    }
  });

  it('excludes tourist accommodation in the same hostaleria sector', () => {
    for (const a of [
      "HABITATGE D'ÚS TURÍSTIC",
      'HUT',
      'HOTEL',
      'HOSTAL',
      'ALLOTJAMENT RURAL',
      'TURISME RURAL',
      'LLAR COMPARTIDA',
      'CASA DE COLÒNIES',
    ]) {
      expect(classifyDibaActivity(a), a).toBeNull();
    }
  });

  it('maps supermarkets', () => {
    expect(classifyDibaActivity('SUPERMERCAT')).toBe('supermercado');
    expect(classifyDibaActivity("SUPERMERCAT D'ALIMENTACIÓ")).toBe('supermercado');
    expect(classifyDibaActivity('AUTOSERVEI')).toBe('supermercado');
  });

  it('maps specific food retail to alimentacion', () => {
    for (const a of [
      'CARNISSERIA',
      'CARNISSERIA AMB OBRADOR',
      'FORN DE PA',
      'PEIXATERIA',
      'FRUITERIA',
      'PASTISSERIA',
      'ROSTISSERIA',
      "COMERÇ AL DETALL D'ALIMENTACIÓ",
      "COMERÇ AL DETALL D'ALIMENTS, BEGUDES I TABAC",
      'VENDA AL DETALL DE CARN',
    ]) {
      expect(classifyDibaActivity(a), a).toBe('alimentacion');
    }
  });

  it('maps drink-focused shops to bodega, but not general groceries or wineries', () => {
    expect(classifyDibaActivity('ESTABLIMENT DE BEGUDES')).toBe('bodega');
    expect(classifyDibaActivity('CELLER')).toBe('bodega');
    expect(classifyDibaActivity('VINOTECA')).toBe('bodega');
    // "aliments, begudes i tabac" is a grocery, not a bodega
    expect(classifyDibaActivity("COMERÇ AL DETALL D'ALIMENTS, BEGUDES I TABAC")).toBe(
      'alimentacion',
    );
    // wine production / vineyard is not retail
    expect(classifyDibaActivity('ELABORACIÓ DE VINS')).toBeNull();
  });

  it('skips clearly non-beer activities', () => {
    for (const a of [
      'FARMÀCIA',
      'PERRUQUERIA',
      'COMERÇ AL DETALL', // generic, no food term
      'VENDA AL DETALL DE ROBA I COMPLEMENTS',
      'FERRETERIA',
      'ESTANC',
      'ÒPTICA',
      'FLORISTERIA',
      'OFICINA BANCÀRIA',
      'EXPLOTACIÓ RAMADERA PORCINA',
      'APARCAMENT PRIVAT',
    ]) {
      expect(classifyDibaActivity(a), a).toBeNull();
    }
  });

  it('word-boundary matching: BAR is a token, not a substring of BARBERIA', () => {
    expect(classifyDibaActivity('BARBERIA')).toBeNull();
    expect(classifyDibaActivity('BASAR')).toBeNull();
  });

  it('excludes fuel stations in v1 (OSM covers gasolineras)', () => {
    expect(classifyDibaActivity('BENZINERA')).toBeNull();
    expect(classifyDibaActivity('ESTACIÓ DE SERVEI')).toBeNull();
  });
});

describe('classifyDibaPremise — sell flags, badges, chain', () => {
  it('a bar sells on-site, not takeaway', () => {
    const r = classifyDibaPremise({ descripcio: 'BAR', name: 'Bar Pepe', chainPatterns: [] });
    expect(r?.placeType).toBe('bar');
    expect(r?.sellsOnsiteBeer).toBe(true);
    expect(r?.sellsTakeawayBeer).toBe(false);
    expect(r?.badges).toContain('vende_cerveza_in_situ');
    expect(r?.badges).toContain('horario_no_confirmado');
  });

  it('a supermarket sells takeaway, not on-site', () => {
    const r = classifyDibaPremise({
      descripcio: 'SUPERMERCAT',
      name: 'Bonpreu',
      chainPatterns: ['bonpreu'],
    });
    expect(r?.placeType).toBe('supermercado');
    expect(r?.sellsTakeawayBeer).toBe(true);
    expect(r?.sellsOnsiteBeer).toBe(false);
    expect(r?.badges).toContain('vende_cerveza_para_llevar');
    expect(r?.isChain).toBe(true);
  });

  it('returns null for a non-beer activity', () => {
    expect(
      classifyDibaPremise({ descripcio: 'FARMÀCIA', name: 'Farmàcia', chainPatterns: [] }),
    ).toBeNull();
  });
});

describe('diba helpers', () => {
  const row = (over: Partial<DibaRow> = {}): DibaRow => ({
    codi_ens: '820210007',
    nom_ens: 'Ajuntament de Sant Celoni',
    identificador: '694',
    descripcio_activitat: 'Restaurant bar',
    nom_comercial: 'Restaurant Els Avets',
    adreca_complerta: 'C MAJOR 63, 08470 Sant Celoni',
    sector_economic: "Activitat d'hostaleria o restauració",
    latitud: '41.6889787',
    longitud: '2.4894559',
    ...over,
  });

  it('derives the municipality from the ens name', () => {
    expect(dibaMunicipi(row())).toBe('Sant Celoni');
    expect(dibaMunicipi(row({ nom_ens: "Ajuntament d'Òdena" }))).toBe('Òdena');
  });

  it('falls back to the activity label when there is no commercial name', () => {
    expect(dibaDisplayName(row())).toBe('Restaurant Els Avets');
    expect(dibaDisplayName(row({ nom_comercial: '' }))).toBe('Restaurant bar');
  });
});
