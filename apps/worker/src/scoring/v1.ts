import {
  EPIGRAPH_BASE_SCORE,
  EPIGRAPH_PRIMARY_CATEGORY,
  type PrimaryCategoryFromEpigraph,
} from './epigraphs.js';

export const SCORING_VERSION = 'v1-deterministic';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'excluded';
export type PrimaryCategory = PrimaryCategoryFromEpigraph | 'ultramarinos';

export type ScoreInput = {
  /** Raw store rótulo / commercial name. */
  name: string;
  /** All activity epigraph codes attached to the local. May contain non-target codes. */
  epigraphCodes: readonly string[];
  /** Official situation code/description from the source (e.g. 'Abierto', 'Baja'). null if unknown. */
  officialStatus: string | null;
  /** Word-boundary chain patterns (normalized, upper-case) — typically from chain_patterns table. */
  chainPatterns: readonly string[];
};

export type ScoreOutput = {
  score: number;
  level: ConfidenceLevel;
  primaryCategory: PrimaryCategory;
  badges: string[];
  isChain: boolean;
  scoringVersion: string;
};

const NAME_HINT_STRONG = [
  'ALIMENTACION',
  'MINI MARKET',
  'MINIMARKET',
  '24H',
  '24 HORAS',
  'ULTRAMARINOS',
  'BODEGA',
];

const NAME_HINT_ADJACENT = ['BEBIDAS', 'FRUTOS SECOS', 'APERITIVOS', 'SNACKS'];

const CLOSED_STATUS_KEYWORDS = ['BAJA', 'CERRADO', 'INACTIVO', 'ANULAD'];

/** Uppercase + strip diacritics. Defensive: tolerates undefined-ish input. */
export const normalize = (s: string | null | undefined): string => {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => haystack.includes(n));

const matchesChainPattern = (name: string, patterns: readonly string[]): boolean => {
  if (!name || patterns.length === 0) return false;
  return patterns.some((raw) => {
    const p = normalize(raw);
    if (!p) return false;
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return re.test(name);
  });
};

const isOfficiallyClosed = (status: string | null): boolean => {
  const s = normalize(status);
  if (!s) return false;
  return CLOSED_STATUS_KEYWORDS.some((k) => s.includes(k));
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

const levelFromScore = (score: number): ConfidenceLevel => {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  if (score >= 30) return 'low';
  return 'excluded';
};

const derivePrimaryCategory = (
  bestEpigraph: string | null,
  normalizedName: string,
): PrimaryCategory => {
  if (normalizedName.includes('ULTRAMARINOS')) return 'ultramarinos';
  if (bestEpigraph && EPIGRAPH_PRIMARY_CATEGORY[bestEpigraph]) {
    return EPIGRAPH_PRIMARY_CATEGORY[bestEpigraph];
  }
  return 'otro';
};

const deriveBadges = (input: {
  epigraphCodes: readonly string[];
  normalizedName: string;
  primaryCategory: PrimaryCategory;
}): string[] => {
  const { epigraphCodes, normalizedName, primaryCategory } = input;
  const badges = new Set<string>();

  if (primaryCategory === 'alimentacion' || primaryCategory === 'ultramarinos') {
    badges.add('alimentacion');
  }
  if (primaryCategory === 'conveniencia') badges.add('conveniencia');
  if (primaryCategory === 'bodega') badges.add('bodega');
  if (primaryCategory === 'snacks') badges.add('snacks');

  for (const code of epigraphCodes) {
    if (code === '472502' || code === '472501') badges.add('bebidas');
    if (code === '472907' || code === '472908' || code === '472909') badges.add('snacks');
    if (code === '471103') badges.add('conveniencia');
  }

  if (normalizedName.includes('BEBIDAS')) badges.add('bebidas');
  if (normalizedName.includes('24H') || normalizedName.includes('24 HORAS')) badges.add('24h');

  // We never have confirmed opening hours yet in MVP — flag it explicitly.
  badges.add('horario_no_confirmado');

  return [...badges];
};

const pickBestEpigraph = (codes: readonly string[]): string | null => {
  let best: string | null = null;
  let bestScore = -1;
  for (const code of codes) {
    const s = EPIGRAPH_BASE_SCORE[code] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = code;
    }
  }
  return best;
};

export function scoreCandidate(input: ScoreInput): ScoreOutput {
  const normalizedName = normalize(input.name);
  const isChain = matchesChainPattern(normalizedName, input.chainPatterns);

  // Hard exclusion: officially closed.
  if (isOfficiallyClosed(input.officialStatus)) {
    return {
      score: 0,
      level: 'excluded',
      primaryCategory: derivePrimaryCategory(pickBestEpigraph(input.epigraphCodes), normalizedName),
      badges: ['posible_cerrado', 'horario_no_confirmado'],
      isChain,
      scoringVersion: SCORING_VERSION,
    };
  }

  // Base score: take the MAX across all epigraphs (do not sum — that would inflate multi-activity locals).
  const bestEpigraph = pickBestEpigraph(input.epigraphCodes);
  const baseScore = bestEpigraph ? (EPIGRAPH_BASE_SCORE[bestEpigraph] ?? 0) : 0;

  // Name hints.
  let nameBonus = 0;
  if (containsAny(normalizedName, NAME_HINT_STRONG)) nameBonus += 20;
  if (containsAny(normalizedName, NAME_HINT_ADJACENT)) nameBonus += 10;

  // Chain penalty per doc 07.
  const chainPenalty = isChain ? -80 : 0;

  // No target epigraph at all → unlikely to be a target shop.
  const noTargetPenalty = baseScore === 0 ? -50 : 0;

  const rawScore = baseScore + nameBonus + chainPenalty + noTargetPenalty;
  const score = clamp(rawScore);

  // Chains are surfaced as excluded regardless of residual score — UI hides them by default.
  const level: ConfidenceLevel = isChain ? 'excluded' : levelFromScore(score);

  const primaryCategory = derivePrimaryCategory(bestEpigraph, normalizedName);
  const badges = deriveBadges({
    epigraphCodes: input.epigraphCodes,
    normalizedName,
    primaryCategory,
  });

  return {
    score,
    level,
    primaryCategory,
    badges,
    isChain,
    scoringVersion: SCORING_VERSION,
  };
}
