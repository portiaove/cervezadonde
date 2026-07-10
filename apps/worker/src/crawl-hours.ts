// Website opening-hours crawler (roadmap §5.2, docs/12 §2).
//
// For stores that carry a website but no OSM hours, fetch the site once,
// look for schema.org hours (sources/schemaorg.ts), validate the converted
// OSM string with the same opening_hours parser the API uses, and persist
// to stores.opening_hours_web. hours_web_checked_at is written on success
// AND failure so re-runs are incremental (skip anything checked recently).
//
// Politeness: descriptive User-Agent, robots.txt honoured (fail-open),
// one request at a time per host with a delay, global concurrency cap,
// 10 s timeout, 2 MB body cap, no spidering beyond the tagged URL.

import { type Sql, getSql } from '@cervezadonde/db';
import OpeningHours from 'opening_hours';
import { hoursFromHtml } from './sources/schemaorg.js';

const USER_AGENT =
  'cervezadonde-hours-bot/1.0 (+https://cervezadonde.es; horarios para un mapa abierto de cervezas)';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SAME_HOST_DELAY_MS = 600;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_AGE_DAYS = 90;

// A URL shared by more stores than this is a brand homepage (mercadona.es
// × 562…): its hours, if any, would be wrong for the individual shops.
const MAX_STORES_PER_URL = 3;

// Hosts that never carry per-business schema.org hours.
const SKIP_HOSTS = new Set([
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tripadvisor.com',
  'tripadvisor.es',
  'wa.me',
  'api.whatsapp.com',
  't.me',
  'linktr.ee',
  'goo.gl',
  'maps.google.com',
  'google.com',
]);

export type CrawlHoursSummary = {
  queuedUrls: number;
  skippedBrandUrls: number;
  skippedHosts: number;
  fetched: number;
  fetchErrors: number;
  robotsBlocked: number;
  hoursFound: number;
  hoursInvalid: number;
  storesUpdated: number;
  storesMarkedChecked: number;
  durationMs: number;
};

type QueueItem = { url: string; host: string; storeIds: string[] };

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

/** The string must survive the exact parser the API evaluates with. */
const validatesAsOsmHours = (hours: string): boolean => {
  try {
    const oh = new OpeningHours(hours, undefined, {
      tag_key: 'opening_hours',
      locale: 'es',
    } as never);
    oh.getState(new Date());
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchCapped(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html') && !type.includes('application/xhtml')) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Minimal robots.txt check: collect Disallow prefixes for `User-agent: *`
 * and for our bot, test the URL path against them. Any robots fetch/parse
 * problem fails OPEN (standard crawler practice for plain sites).
 */
async function isAllowedByRobots(
  url: string,
  cache: Map<string, string[] | 'allow-all'>,
): Promise<boolean> {
  const parsed = new URL(url);
  const key = parsed.origin;
  let rules = cache.get(key);
  if (rules === undefined) {
    rules = 'allow-all';
    try {
      const res = await fetch(`${key}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const text = await res.text();
        const disallows: string[] = [];
        let applies = false;
        for (const rawLine of text.split('\n')) {
          const line = rawLine.replace(/#.*$/, '').trim();
          const ua = line
            .match(/^user-agent:\s*(.+)$/i)?.[1]
            ?.trim()
            .toLowerCase();
          if (ua !== undefined) {
            applies = ua === '*' || ua.includes('cervezadonde');
            continue;
          }
          const dis = line.match(/^disallow:\s*(.*)$/i)?.[1]?.trim();
          if (applies && dis) disallows.push(dis);
        }
        rules = disallows.length > 0 ? disallows : 'allow-all';
      }
    } catch {
      rules = 'allow-all';
    }
    cache.set(key, rules);
  }
  if (rules === 'allow-all') return true;
  const path = parsed.pathname || '/';
  return !rules.some((prefix) => path.startsWith(prefix));
}

async function loadQueue(
  sql: Sql,
  maxAgeDays: number,
  limit: number | null,
): Promise<{ items: QueueItem[]; skippedBrandUrls: number; skippedHosts: number }> {
  const rows = await sql<{ website: string; ids: string[] }[]>`
    SELECT website, array_agg(id::text) AS ids
    FROM stores
    WHERE website IS NOT NULL
      AND opening_hours_osm IS NULL
      AND confidence_level <> 'excluded'
      AND (hours_web_checked_at IS NULL
           OR hours_web_checked_at < now() - make_interval(days => ${maxAgeDays}))
    GROUP BY website
    ORDER BY website
  `;

  let skippedBrandUrls = 0;
  let skippedHosts = 0;
  const items: QueueItem[] = [];
  for (const row of rows) {
    if (row.ids.length > MAX_STORES_PER_URL) {
      skippedBrandUrls += 1;
      continue;
    }
    const host = hostOf(row.website);
    if (!host || SKIP_HOSTS.has(host)) {
      skippedHosts += 1;
      continue;
    }
    items.push({ url: row.website, host, storeIds: row.ids });
  }
  const sliced = limit ? items.slice(0, limit) : items;
  return { items: sliced, skippedBrandUrls, skippedHosts };
}

export async function crawlHours(opts: {
  limit?: number;
  concurrency?: number;
  maxAgeDays?: number;
  log?: (msg: string) => void;
}): Promise<CrawlHoursSummary> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const sql = getSql();
  const startedAt = Date.now();
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const { items, skippedBrandUrls, skippedHosts } = await loadQueue(
    sql,
    opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
    opts.limit ?? null,
  );
  log(
    `queue: ${items.length} URLs (${skippedBrandUrls} brand URLs + ${skippedHosts} social/aggregator skipped)`,
  );

  // Per-host buckets; workers take a whole host and walk it sequentially,
  // so no host ever sees concurrent requests from us.
  const byHost = new Map<string, QueueItem[]>();
  for (const item of items) {
    const bucket = byHost.get(item.host) ?? [];
    bucket.push(item);
    byHost.set(item.host, bucket);
  }
  const hosts = [...byHost.keys()];
  let hostIdx = 0;

  const robotsCache = new Map<string, string[] | 'allow-all'>();
  const summary: CrawlHoursSummary = {
    queuedUrls: items.length,
    skippedBrandUrls,
    skippedHosts,
    fetched: 0,
    fetchErrors: 0,
    robotsBlocked: 0,
    hoursFound: 0,
    hoursInvalid: 0,
    storesUpdated: 0,
    storesMarkedChecked: 0,
    durationMs: 0,
  };
  let processed = 0;

  const markChecked = async (storeIds: string[], hours: string | null): Promise<void> => {
    await sql`
      UPDATE stores SET
        opening_hours_web = COALESCE(${hours}, opening_hours_web),
        hours_web_checked_at = now(),
        updated_at = now()
      WHERE id = ANY(${storeIds}::bigint[])
    `;
    if (hours) summary.storesUpdated += storeIds.length;
    else summary.storesMarkedChecked += storeIds.length;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const myHost = hosts[hostIdx++];
      if (!myHost) return;
      const bucket = byHost.get(myHost) ?? [];
      for (const item of bucket) {
        try {
          if (!(await isAllowedByRobots(item.url, robotsCache))) {
            summary.robotsBlocked += 1;
            await markChecked(item.storeIds, null);
            continue;
          }
          const html = await fetchCapped(item.url);
          if (html === null) {
            summary.fetchErrors += 1;
            await markChecked(item.storeIds, null);
            continue;
          }
          summary.fetched += 1;

          const hours = hoursFromHtml(html);
          if (hours && validatesAsOsmHours(hours)) {
            summary.hoursFound += 1;
            await markChecked(item.storeIds, hours);
          } else {
            if (hours) summary.hoursInvalid += 1;
            await markChecked(item.storeIds, null);
          }
        } catch {
          summary.fetchErrors += 1;
          await markChecked(item.storeIds, null).catch(() => undefined);
        }
        processed += 1;
        if (processed % 200 === 0) {
          log(`  ${processed}/${items.length} URLs · ${summary.hoursFound} with hours`);
        }
        if (bucket.length > 1) await sleep(SAME_HOST_DELAY_MS);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  summary.durationMs = Date.now() - startedAt;
  return summary;
}
