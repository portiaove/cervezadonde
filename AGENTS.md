# Working on cervezadonde.es

cervezadonde.es is a live, Spain-wide, mobile-first map for finding the nearest
beer source. OSM is the national POI backbone; official censos enrich Madrid,
Barcelona city, Barcelona province (DIBA), and Andalucía. The service runs on a
single VPS, while the heavy data pipeline runs on the maintainer's Windows PC.

Before changing anything, read:

1. `docs/17-project-atlas.md` — current system and product map.
2. `docs/18-data-quality-atlas.md` — the truth model and known false-positive
   paths.
3. `docs/README.md` — documentation authority and supersession map.

## Product invariants

- The primary job is: find a nearby place that can serve or sell beer now.
- Keep `barra` (consume on-site) and `lata` (take away) explicit.
- Be honest about uncertainty. Existence, classification, hours, and freshness
  are separate dimensions.
- Never describe owners by ethnicity or origin; classify places functionally.
- Do not scrape or bulk-copy Google Maps/Places data. A user-facing directions
  link is not a data source.
- Do not call a place verified merely because it is close to a censo point.
  `verification='verified'` is the current API label for a 30 m spatial match,
  not proof that both records are the same business.

## Engineering invariants

- `packages/shared` is the HTTP contract; migrations are the persisted schema.
- `apps/api/src/openNow.ts` owns time and beer-availability evaluation.
- `apps/worker/src/ingest-osm-canonical.ts` owns OSM persistence, stale pruning,
  and OSM↔censo merging.
- A full data build runs censos first, OSM second, website hours third.
- Only a whole-Spain OSM ingest may prune unseen OSM rows.
- Never use Madrid's ordinance or `Europe/Madrid` time as if they were a
  Spain-wide rule without an explicit geographic policy.
- `ingest:madrid --limit` currently still runs soft-deactivation; do not use it
  against a populated database as a harmless sample command.
- Preserve source IDs, source names, import-run links, scoring versions, and
  timestamps. Prefer reversible exclusion over deletion.

## Repository hygiene

- Preserve uncommitted user work and inspect `git status` before edits.
- Do not read or print `.env`; use `.env.example` for configuration shape.
- Raw files under `data/raw` and database files are runtime artifacts, not
  source.
- Run `pnpm test` and `pnpm typecheck` for behavioral changes. `pnpm lint`
  currently has known baseline failures documented in the atlas; do not claim a
  clean lint run unless those are actually resolved.
- Treat items in the atlas decision queue as questions, not an approved
  roadmap. Prefer evidence from production behavior and data audits.
