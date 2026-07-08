// Doc-07 epigraph groups. Codes from the Madrid census epigraph catalogue.

export const STRONG_TARGET_EPIGRAPHS = {
  '471103': 'Tienda de conveniencia / 24h',
  '471101': 'Comercio no especializado con predominio de alimentacion',
  '471104': 'Comercio no especializado envasado',
  '472911': 'Otros comercios de alimentacion variada',
} as const;

export const ADJACENT_TARGET_EPIGRAPHS = {
  '472502': 'Bebidas alcoholicas sin consumo',
  '472907': 'Frutos secos y aperitivos',
  '472908': 'Patatas fritas y aperitivos',
  '472909': 'Aperitivos varios',
  '472501': 'Leche, productos lacteos y bebidas no alcoholicas',
} as const;

export const EPIGRAPH_BASE_SCORE: Record<string, number> = {
  '471103': 100,
  '471101': 90,
  '471104': 90,
  '472911': 80,
  '472502': 65,
  '472907': 55,
  '472908': 55,
  '472909': 55,
  '472501': 45,
};

export type PrimaryCategoryFromEpigraph =
  | 'conveniencia'
  | 'alimentacion'
  | 'bodega'
  | 'snacks'
  | 'otro';

export const EPIGRAPH_PRIMARY_CATEGORY: Record<string, PrimaryCategoryFromEpigraph> = {
  '471103': 'conveniencia',
  '471101': 'alimentacion',
  '471104': 'alimentacion',
  '472911': 'alimentacion',
  '472502': 'bodega',
  '472907': 'snacks',
  '472908': 'snacks',
  '472909': 'snacks',
  '472501': 'alimentacion',
};

export const TARGET_EPIGRAPH_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(STRONG_TARGET_EPIGRAPHS),
  ...Object.keys(ADJACENT_TARGET_EPIGRAPHS),
]);

export const isTargetEpigraph = (code: string): boolean =>
  TARGET_EPIGRAPH_CODES.has(code);

// --- Beer pivot (M6+) -------------------------------------------------------
// Bars / cafeterías serve beer on-site. These join the target set in v2.
// CNAE-09 division 561 (servicios de comidas y bebidas).

export const BAR_EPIGRAPHS = {
  '561001': 'Bares',
  '561002': 'Cafes',
  '561004': 'Bares especiales',
  '561005': 'Cafeterias',
} as const;

export const BAR_EPIGRAPH_CODES: ReadonlySet<string> = new Set(
  Object.keys(BAR_EPIGRAPHS),
);

export const isBarEpigraph = (code: string): boolean =>
  BAR_EPIGRAPH_CODES.has(code);

/** Expanded target set used by the beer-pivot ingest (M6d). */
export const TARGET_EPIGRAPH_CODES_V2: ReadonlySet<string> = new Set([
  ...Object.keys(STRONG_TARGET_EPIGRAPHS),
  ...Object.keys(ADJACENT_TARGET_EPIGRAPHS),
  ...Object.keys(BAR_EPIGRAPHS),
]);

export const isTargetEpigraphV2 = (code: string): boolean =>
  TARGET_EPIGRAPH_CODES_V2.has(code);
