# 11 — Operations Runbook

Operational reference for refreshing data, verifying ingest, and
troubleshooting. Pair with `06-ingestion-pipeline.md` (the *what*) and
`07-scoring-classification.md` (the *how* of scoring).

## Daily refresh

```powershell
pnpm worker:ingest:madrid
```

Idempotent — always safe to re-run. Expected duration:

| Cache state | Total time |
|---|---|
| Fresh download | ~5–10 minutes |
| Cache hit (default) | ~2–4 minutes |
| `--limit 200` (sanity) | ~30 seconds |

Force a re-download with `--fresh` if you suspect the cache is stale.

## Weekly OSM refresh (Phase 1 / M6g)

```powershell
pnpm worker:ingest:osm
```

Fetches Madrid bbox from Overpass, matches to `stores`, materialises
`opening_hours_osm`. Cheap enough to run manually after a scorer change.

## Madrid Censo pipeline stages

| # | Stage | Owner | Output |
|---|---|---|---|
| 1 | Download or cache hit | `download.ts` | local CSV, SHA-256 hash |
| 2 | Open `import_run` | `ingest-madrid.ts` | `import_runs.id` (status='running') |
| 3 | `TRUNCATE staging_madrid_actividades` | Postgres | empty staging |
| 4 | `COPY FROM STDIN` | Postgres | 225k rows in staging |
| 5 | Aggregate candidates per `id_local` | Postgres | ~5–15k rows in Node |
| 6 | Score + upsert | `scoring/v2.ts` + Postgres | rows in `stores` |
| 7 | Soft-deactivate missing | Postgres | rows flagged `posible_cerrado` |
| 8 | Finalise `import_run` | Postgres | status='succeeded', counts |

Stage 5 filters (current):

- `id_tipo_acceso_local = '1'` (Puerta Calle — direct street access)
- `id_situacion_local = '1'` (Abierto)
- Coordinates parseable AND inside Madrid UTM bbox `(420000–470000, 4460000–4495000)`
- At least one epigraph code in the doc-02 expanded target set
  (471xxx + 472xxx + 561xxx)

## Verification queries

Run after every full ingest.

### How many stores, by source

```sql
SELECT source_name, count(*) FROM stores GROUP BY 1 ORDER BY 1;
```

### Confidence distribution

```sql
SELECT confidence_level, count(*) FROM stores
WHERE source_name='madrid_censo'
GROUP BY 1 ORDER BY 1;
```

`excluded` should be < 10%. After M6, chains are no longer excluded — only
hard exclusions remain (closed, invalid).

### place_type breakdown (post-M6b)

```sql
SELECT place_type, count(*) FROM stores
WHERE source_name='madrid_censo'
GROUP BY 1 ORDER BY 2 DESC;
```

Expect bars to be a large share; the bar epigraphs are densely populated.

### Hours coverage (post-M6g)

```sql
SELECT
  count(*) FILTER (WHERE opening_hours_osm IS NOT NULL) AS with_hours,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE opening_hours_osm IS NOT NULL) / count(*), 1) AS pct
FROM stores WHERE source_name='madrid_censo';
```

Target: > 30% coverage after the first OSM run, rising over time.

### Scoring version coverage

```sql
SELECT scoring_version, count(*) FROM stores GROUP BY 1;
```

Old versions = re-run needed.

### Last import status

```sql
SELECT id, source_name, status, row_count,
       inserted_count, updated_count, deactivated_count,
       finished_at - started_at AS duration
FROM import_runs ORDER BY id DESC LIMIT 5;
```

### Spot-check Sol

```sql
SELECT name, place_type, confidence_score, confidence_level, badges
FROM stores
WHERE source_name='madrid_censo' AND confidence_level <> 'excluded'
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(-3.7038, 40.4168), 4326)
LIMIT 10;
```

## When the scorer changes

```powershell
pnpm --filter @cervezadonde/worker test    # unit tests must pass
pnpm worker:ingest:madrid                # cache hit, re-scores in place
```

Bump `SCORING_VERSION` in `scoring/v2.ts` when changing rules. The
`scoring_version` column lets you spot un-rescored rows.

## Common errors

### `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`

`.env` not loaded. Use the root script (`pnpm db:migrate`), not the workspace
command directly.

### `download failed: 5xx` / network timeout

datos.madrid.es is occasionally slow. Retry. No partial files are written.

### `aggregated 0 target candidates`

Re-run `pnpm worker:diagnose:madrid` and check columns + counts. If `1
Puerta Calle` and `1 Abierto` look healthy but candidates dropped to 0,
the epigraph target set might be filtering everything out — verify the
constants in `apps/worker/src/scoring/epigraphs.ts` match doc 02.

### `ERROR: extra data after last expected column`

CSV column count drifted. `diagnose:madrid` shows the diff.

### Map shows green only, no streets

`tile.openstreetmap.org` blocked. Devtools → Network confirms. Swap to a
different free tile provider in `apps/web/src/App.tsx`.

## Source-name conventions

- `madrid_sample_fixture` — bundled beer-source fixture (25–40 rows).
- `madrid_censo` — real Censo data.
- `osm_only` — OSM-only places without a Censo match (v1.1+).

Soft-deactivate only ever touches the source it ran for.

## Cache locations

```
apps/worker/data/raw/madrid-actividades.csv   ← Censo cache
apps/worker/data/raw/osm-madrid-{date}.json   ← OSM cache (post-M6g)
```

Both are matched by `data/raw/` in `.gitignore`.

## Soft-deactivation semantics

When `ingest:madrid` finishes, any `madrid_censo` row whose
`last_import_run_id` is not the current one gets:

- `confidence_level='excluded'` (API hides by default).
- `'posible_cerrado'` appended to badges.
- `confidence_score` preserved (provenance).

Never hard-deleted. Re-appearance restores via the upsert path.

## Performance notes

- PostGIS GIST on `geom` keeps nearby fast at million-row scale.
- Sequential per-candidate upsert is fine at 5–15k rows. Batch only when
  we add cities.
- 122 MB CSV streams end-to-end; never fully buffered.

## What's next

- Add `chain_patterns` admin endpoint so the list is editable at runtime.
- Track per-import counts as time-series for drift detection.
- Once OSM ingest lands (M6g), watch hour-coverage percentage; aim > 50%
  in central Madrid.
