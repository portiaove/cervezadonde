// schema.org opening-hours extraction (docs/12 §2, roadmap §5.2).
//
// Pure functions: given an HTML document, find JSON-LD blocks, locate
// openingHoursSpecification / openingHours on any node (LocalBusiness,
// Restaurant, BarOrPub, Store, @graph members…), and convert to OSM
// opening_hours syntax so the API evaluates crawled hours with the exact
// same parser as OSM data. The caller validates the result with the
// opening_hours library before persisting — nothing unparseable is stored.

const DAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
type OsmDay = (typeof DAY_ORDER)[number];

/** "https://schema.org/Monday" | "Monday" | "Mo" | "mon" → "Mo". */
const SCHEMA_DAY_TO_OSM: Record<string, OsmDay> = {
  monday: 'Mo',
  tuesday: 'Tu',
  wednesday: 'We',
  thursday: 'Th',
  friday: 'Fr',
  saturday: 'Sa',
  sunday: 'Su',
  mo: 'Mo',
  tu: 'Tu',
  we: 'We',
  th: 'Th',
  fr: 'Fr',
  sa: 'Sa',
  su: 'Su',
  mon: 'Mo',
  tue: 'Tu',
  wed: 'We',
  thu: 'Th',
  fri: 'Fr',
  sat: 'Sa',
  sun: 'Su',
};

const normalizeDay = (raw: unknown): OsmDay | null => {
  if (typeof raw !== 'string') return null;
  const last = raw.trim().split('/').pop() ?? '';
  return SCHEMA_DAY_TO_OSM[last.toLowerCase()] ?? null;
};

/** "9:00" | "09:00" | "09:00:00" → "09:00"; rejects anything else. */
const normalizeTime = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

/** Extract every JSON-LD payload from the document, tolerating bad blocks. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  // Tolerant on the type value: real pages ship "application/ld+json;charset=utf-8" etc.
  const re = /<script[^>]*type\s*=\s*["'][^"']*ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const body = match[1];
    if (!body) continue;
    try {
      out.push(JSON.parse(body.trim()));
    } catch {
      // One malformed block must not sink the rest of the page.
    }
  }
  return out;
}

type HoursSpec = { days: OsmDay[]; opens: string; closes: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Depth-first walk over JSON-LD (arrays, @graph, nested nodes). */
function* walkNodes(node: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkNodes(item, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  yield node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'department', 'itemListElement']) {
    if (node[key]) yield* walkNodes(node[key], depth + 1);
  }
}

const parseSpecObject = (spec: unknown): HoursSpec | null => {
  if (!isRecord(spec)) return null;
  const rawDays = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
  const days = rawDays.map(normalizeDay).filter((d): d is OsmDay => d !== null);
  const opens = normalizeTime(spec.opens);
  const closes = normalizeTime(spec.closes);
  if (days.length === 0 || !opens || !closes || opens === closes) return null;
  return { days, opens, closes };
};

/**
 * schema.org's `openingHours` shorthand ("Mo-Sa 11:00-14:30", "Mo,Tu 10:00-20:00")
 * is almost OSM already — normalise separators and validate the shape.
 */
const parseOpeningHoursString = (raw: unknown): HoursSpec[] => {
  if (typeof raw !== 'string') return [];
  const m = raw
    .trim()
    .match(/^([A-Za-z]{2,3}(?:\s*[-,]\s*[A-Za-z]{2,3})*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!m || !m[1] || !m[2] || !m[3]) return [];
  const opens = normalizeTime(m[2]);
  const closes = normalizeTime(m[3]);
  if (!opens || !closes || opens === closes) return [];

  const days: OsmDay[] = [];
  for (const part of m[1].split(',')) {
    const range = part.split('-').map((d) => normalizeDay(d));
    if (range.length === 1 && range[0]) {
      days.push(range[0]);
    } else if (range.length === 2 && range[0] && range[1]) {
      const from = DAY_ORDER.indexOf(range[0]);
      const to = DAY_ORDER.indexOf(range[1]);
      if (from === -1 || to === -1 || to < from) return [];
      days.push(...DAY_ORDER.slice(from, to + 1));
    } else {
      return [];
    }
  }
  return days.length > 0 ? [{ days, opens, closes }] : [];
};

/** Collect every hours spec found anywhere in the document's JSON-LD. */
export function findHoursSpecs(html: string): HoursSpec[] {
  const specs: HoursSpec[] = [];
  for (const payload of extractJsonLd(html)) {
    for (const node of walkNodes(payload)) {
      const spec = node.openingHoursSpecification;
      if (spec) {
        for (const s of Array.isArray(spec) ? spec : [spec]) {
          const parsed = parseSpecObject(s);
          if (parsed) specs.push(parsed);
        }
      }
      const shorthand = node.openingHours;
      if (shorthand) {
        for (const s of Array.isArray(shorthand) ? shorthand : [shorthand]) {
          specs.push(...parseOpeningHoursString(s));
        }
      }
    }
  }
  return specs;
}

/**
 * Compose specs into one OSM opening_hours string:
 * per-day intervals (split shifts joined with ","), consecutive days with
 * identical intervals merged into ranges ("Mo-Fr 09:00-20:00").
 * Returns null when there is nothing usable.
 */
export function specsToOsmHours(specs: HoursSpec[]): string | null {
  if (specs.length === 0) return null;

  const byDay = new Map<OsmDay, Set<string>>();
  for (const spec of specs) {
    // schema.org "00:00" as a closing time means midnight → OSM "24:00".
    const closes = spec.closes === '00:00' ? '24:00' : spec.closes;
    for (const day of spec.days) {
      const set = byDay.get(day) ?? new Set<string>();
      set.add(`${spec.opens}-${closes}`);
      byDay.set(day, set);
    }
  }
  if (byDay.size === 0) return null;

  const dayInterval = new Map<OsmDay, string>();
  for (const [day, set] of byDay) {
    dayInterval.set(day, [...set].sort().join(','));
  }

  // Merge consecutive days sharing the same intervals.
  const parts: string[] = [];
  let runStart: OsmDay | null = null;
  let runEnd: OsmDay | null = null;
  let runValue: string | null = null;
  const flush = () => {
    if (!runStart || !runEnd || !runValue) return;
    const days = runStart === runEnd ? runStart : `${runStart}-${runEnd}`;
    parts.push(`${days} ${runValue}`);
  };
  for (const day of DAY_ORDER) {
    const value = dayInterval.get(day) ?? null;
    if (value !== null && value === runValue) {
      runEnd = day;
      continue;
    }
    flush();
    runStart = value !== null ? day : null;
    runEnd = runStart;
    runValue = value;
  }
  flush();

  const result = parts.join('; ');
  // Guard rails: something went sideways if it's empty or absurdly long.
  if (!result || result.length > 255) return null;
  return result;
}

/** One-call façade: HTML in, OSM opening_hours out (or null). */
export function hoursFromHtml(html: string): string | null {
  return specsToOsmHours(findHoursSpecs(html));
}
