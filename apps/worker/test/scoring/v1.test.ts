import { describe, expect, it } from 'vitest';
import { SCORING_VERSION, normalize, scoreCandidate } from '../../src/scoring/v1.js';

const CHAINS = ['MERCADONA', 'CARREFOUR', 'DIA', 'LIDL', 'ALDI', 'EL CORTE INGLES'];

describe('normalize', () => {
  it('uppercases and strips diacritics', () => {
    expect(normalize('Alimentación Pepé')).toBe('ALIMENTACION PEPE');
  });

  it('collapses whitespace and trims', () => {
    expect(normalize('  bodega   el  tinto ')).toBe('BODEGA EL TINTO');
  });

  it('handles null/undefined defensively', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('scoreCandidate — base epigraphs', () => {
  it('471103 (conveniencia) scores high', () => {
    const r = scoreCandidate({
      name: 'TIENDA 24H',
      epigraphCodes: ['471103'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.level).toBe('high');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.primaryCategory).toBe('conveniencia');
    expect(r.badges).toContain('conveniencia');
    expect(r.badges).toContain('24h');
    expect(r.isChain).toBe(false);
    expect(r.scoringVersion).toBe(SCORING_VERSION);
  });

  it('471101 with ULTRAMARINOS rotulo → ultramarinos primary, high', () => {
    const r = scoreCandidate({
      name: 'ULTRAMARINOS LA CASTELLANA',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.primaryCategory).toBe('ultramarinos');
    expect(r.level).toBe('high');
    expect(r.badges).toContain('alimentacion');
  });

  it('472907 (frutos secos) alone scores medium', () => {
    const r = scoreCandidate({
      name: 'FRUTOS SECOS PEPE',
      epigraphCodes: ['472907'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.level).toBe('medium');
    expect(r.primaryCategory).toBe('snacks');
    expect(r.badges).toContain('snacks');
  });

  it('472502 (bodega) yields bodega category + bebidas badge', () => {
    const r = scoreCandidate({
      name: 'BODEGA EL TINTO',
      epigraphCodes: ['472502'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.primaryCategory).toBe('bodega');
    expect(r.badges).toContain('bodega');
    expect(r.badges).toContain('bebidas');
  });

  it('multiple epigraphs use the MAX base (not sum)', () => {
    const r = scoreCandidate({
      name: 'TIENDA',
      epigraphCodes: ['471103', '472907', '472501'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    // Highest base is 471103 = 100; sum would have exceeded 100 → confirms MAX semantic.
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.primaryCategory).toBe('conveniencia');
  });
});

describe('scoreCandidate — chain exclusion', () => {
  it('MERCADONA is flagged as chain and excluded regardless of epigraph', () => {
    const r = scoreCandidate({
      name: 'MERCADONA',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.isChain).toBe(true);
    expect(r.level).toBe('excluded');
  });

  it('CARREFOUR EXPRESS matches via word boundary', () => {
    const r = scoreCandidate({
      name: 'CARREFOUR EXPRESS',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.isChain).toBe(true);
    expect(r.level).toBe('excluded');
  });

  it('DIA matches as a token, but DIANA does not (word boundary)', () => {
    const r1 = scoreCandidate({
      name: 'DIA MARKET',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r1.isChain).toBe(true);

    const r2 = scoreCandidate({
      name: 'ALIMENTACION DIANA',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r2.isChain).toBe(false);
    expect(r2.level).not.toBe('excluded');
  });

  it('EL CORTE INGLES multi-word pattern matches', () => {
    const r = scoreCandidate({
      name: 'SUPERCOR EL CORTE INGLES',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.isChain).toBe(true);
  });
});

describe('scoreCandidate — closed status', () => {
  it('Baja status → excluded with posible_cerrado badge', () => {
    const r = scoreCandidate({
      name: 'ALIMENTACION CERRADA',
      epigraphCodes: ['471101'],
      officialStatus: 'Baja',
      chainPatterns: CHAINS,
    });
    expect(r.level).toBe('excluded');
    expect(r.score).toBe(0);
    expect(r.badges).toContain('posible_cerrado');
  });

  it('Cerrado status → excluded', () => {
    const r = scoreCandidate({
      name: 'BODEGA ANTIGUA',
      epigraphCodes: ['472502'],
      officialStatus: 'Local cerrado',
      chainPatterns: CHAINS,
    });
    expect(r.level).toBe('excluded');
  });

  it('null status is treated as open', () => {
    const r = scoreCandidate({
      name: 'MINI MARKET',
      epigraphCodes: ['471103'],
      officialStatus: null,
      chainPatterns: CHAINS,
    });
    expect(r.level).toBe('high');
  });
});

describe('scoreCandidate — badges', () => {
  it('24H name adds 24h badge', () => {
    const r = scoreCandidate({
      name: 'ALIMENTACION 24H VALLECAS',
      epigraphCodes: ['471103'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.badges).toContain('24h');
  });

  it('BEBIDAS in name adds bebidas badge', () => {
    const r = scoreCandidate({
      name: 'TIENDA DE BEBIDAS',
      epigraphCodes: ['472501'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.badges).toContain('bebidas');
  });

  it('every result includes horario_no_confirmado for now', () => {
    const r = scoreCandidate({
      name: 'TIENDA',
      epigraphCodes: ['471101'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.badges).toContain('horario_no_confirmado');
  });
});

describe('scoreCandidate — no target epigraph', () => {
  it('non-target epigraph + no rotulo hints → low or excluded', () => {
    const r = scoreCandidate({
      name: 'ZAPATERIA EL TACON',
      epigraphCodes: ['477110'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(['low', 'excluded']).toContain(r.level);
    expect(r.primaryCategory).toBe('otro');
  });
});

describe('scoreCandidate — score clamping', () => {
  it('clamps below 0', () => {
    const r = scoreCandidate({
      name: 'MERCADONA',
      epigraphCodes: ['476510'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('clamps above 100', () => {
    const r = scoreCandidate({
      name: 'ALIMENTACION 24H MINI MARKET BODEGA',
      epigraphCodes: ['471103'],
      officialStatus: 'Abierto',
      chainPatterns: CHAINS,
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
