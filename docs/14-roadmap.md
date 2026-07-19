# 14 — Roadmap / next steps (handoff)

Written 2026-07-09, at the end of the session that shipped the app nationally.
Ordered by the maintainer's chosen priority: **UX → official-censo enrichment →
operations & observability → minor debts → opening hours (last, the big one).**

Current state: cervezadonde.es is **live**, covers **all of Spain (~168k
stores)**, deploys code via GitHub Actions and data via `push-data.ps1`. See
[`docs/00-overview.md`](./00-overview.md) for the architecture.

---

## 1. UX improvements

### 1a. The map at national scale (most important UX item)
With ~168k stores, `/stores/map` returns up to its `limit` (1500) per viewport.
At low zoom (all of Spain / a whole province) that is sparse, misleading, and
heavy to render.

- **Recommended: MapLibre native clustering.** Set `cluster: true` +
  `clusterRadius`/`clusterMaxZoom` on the GeoJSON `Source` in
  `apps/web/src/App.tsx`, add a cluster circle layer (count labels) + the
  existing per-point layer for high zoom. Zero backend change.
- **Plus zoom-gating:** below ~z12 show clusters only; the per-store markers +
  the lata/barra colouring appear when zoomed in. Consider a "acércate para ver
  locales" hint when the viewport is too broad.
- Watch the `fetchMap` `limit` (currently 1500) — with clustering you can raise
  it, or better, keep it and let clusters summarise.

### 1b. Smaller UX polish
- Loading / empty states (spinner while fetching, "no hay locales abiertos
  cerca" when a filter empties the map).
- The **nearest-open card** only shows after "Cerca de mí" — consider surfacing
  it proactively, and a "cómo llegar" link (opens the device maps app).
- Mobile bottom-sheet ergonomics for `StoreCard`.
- Consider making **"Abre ahora"** a sensible default once hours coverage is up.

---

## 2. Enrich with official censos where available

We already do this for Madrid: `ingest:madrid` → `source_name='censo_madrid'`,
then `enrichWithCenso` merges official fields onto the matched OSM store and
flags `oficial` (see [ADR-007](../decisions/ADR-007-national-osm-primary.md)).

To extend to other cities:
- ~~**Generalise the merge.**~~ **Done**: `enrichWithCenso` (in
  `apps/worker/src/ingest-osm-canonical.ts`) matches any official source via
  `source_name LIKE 'censo_%'` (migration 1700000000006 renamed
  `madrid_censo` → `censo_madrid`).
- **One adapter per city** (each open-data portal has its own schema): download
  + parse + map to the `stores` shape under `source_name='censo_<city>'`, same
  as `ingest-madrid.ts`.
  - **Barcelona city: DONE** (`pnpm worker:ingest:barcelona`; "Cens d'activitats
    econòmiques en planta baixa" 2024, CC BY 4.0). Classification is a direct
    activity-code lookup (`sources/barcelona.ts`) — far simpler than Madrid's
    epigraph heuristics. 12,963 beer-relevant premises; enrich flags ~8,258
    OSM stores `oficial` in BCN and keeps ~6,100 censo-only places.
  - **Barcelona province (DIBA): DONE** (`pnpm worker:ingest:diba`; the GIA
    "Cens municipal d'activitats i establiments" of the Diputació de Barcelona,
    CC BY 4.0, served via the Socrata open-data portal so the full ~42k-row
    dataset is downloadable — the `do.diba.cat` API caps at 1000 rows). Covers
    the **184 municipalities of the province** (the metro belt; Barcelona *city*
    is excluded — it has its own census above). GIA has no activity-code list,
    so `sources/diba.ts` classifies conservatively by free-text Catalan activity
    (word-token matching so `BAR` ≠ `BARBERIA`). **6,288 beer-relevant premises**
    (bar 3,475 · alimentación 2,153 · súper 524 · bodega 136). No opening hours
    in GIA, so every row carries `horario_no_confirmado`. Enrichment flags
    ~1,298 matched OSM stores `oficial` and keeps **4,990 censo-only places**
    (3,045 high + 1,945 medium confidence) that OSM was missing across the
    province — national active total rose to ~188.7k.
  - **Andalucía (IECA): DONE** (`pnpm worker:ingest:andalucia`; the IECA/Junta
    de Andalucía "Directorio de empresas y establecimientos con actividad
    económica", CC BY 4.0). Covers the **8 provinces** (Sevilla, Málaga, Córdoba,
    Granada, Almería, Cádiz, Huelva, Jaén) — the biggest censo yet. Ingested from
    the **point-level WFS layer `estab_geo24`** (not the aggregated statistical
    grid `gridestab24`), filtered server-side by CNAE and reprojected to WGS84 by
    GeoServer (`sources/andalucia.ts`). Classification is a direct **CNAE-2009
    code lookup** (like Barcelona city). **25,255 beer-relevant establishments**
    (bar 16,239 · súper 4,963 · alim 3,858 · bodega 195) across 629 municipalities.
    Enrichment flags **~6,676 matched OSM stores `oficial`** and keeps **18,579
    censo-only places** (15,415 high + 3,164 medium) OSM was missing across the
    region — national active total rose to **~207.3k**.
    Caveat: the directory carries only the **razón social** (legal name), not the
    trading name — so censo-only rows show e.g. "DEBA SARDA SL"; matched OSM stores
    keep OSM's real name via the merge. No opening hours → `horario_no_confirmado`.
  - Remaining candidates: **Zaragoza** (one clean big city; own portal, license +
    format to verify). **Valencia** stays OSM-only (no point-level open data — only
    aggregated by district). Málaga/Sevilla/Córdoba/Granada are now covered by the
    Andalucía censo above.
- This is **incremental polish**: OSM already covers these cities; the censo
  only adds the official confirmation + richer address/status.
- Decide per city whether the adapter effort is worth the quality gain.

---

## 3. Operations & observability

### 3a. Weekly data refresh (automate) — ✅ DONE
`scripts/refresh-all.ps1` runs the whole pipeline in order (Madrid + Barcelona
city + Barcelona province + Andalucía censos → all-Spain OSM+enrichment →
website hours crawl → `push-data.ps1`),
logs each run to `logs/refresh-history.csv` + a transcript, and is scheduled
with **Windows Task Scheduler** (`StartWhenAvailable`, no wake; runs only when
logged on, catches up on next login). Setup command in
[`docs/13-deploy.md`](./13-deploy.md) §2. The Geofabrik Spain extract updates
~monthly, so weekly is plenty (`-NoFreshPbf` to reuse the cached extract).

### 3b. Backups
- **Data is regenerable** from the PC pipeline, so the VPS DB isn't precious
  *yet*. That changes the moment **user feedback** (Phase 2) lands — then the
  feedback table must be backed up.
- Cheap wins now: enable **Hetzner automatic backups/snapshots** (~1 €/mo) for
  the whole VPS; keep the last few `serving.dump` files locally.
- Later: a nightly `pg_dump` on the VPS to an offsite bucket (only needed once
  there's non-regenerable data).

### 3c. Monitoring & logs
- **Data freshness** — ✅ `GET /api/meta` returns `data_updated_at` (last
  refresh) + `active_stores` / `stores_with_hours`. Surfaced in the app's
  "Datos" sheet ("Datos actualizados el …"). Handy as a cheap post-refresh
  sanity check; `/health` stays DB-free for the uptime probe.
- **Uptime**: external monitor hitting `https://cervezadonde.es/api/health`
  (e.g. **UptimeRobot**, free) → alert on downtime. Would have caught today's
  404 immediately (note: monitor `/` too, not just the API, since today the API
  was up but the web was 404).
- **Error tracking**: add **Sentry** (free tier) to both the API (Fastify) and
  the web (React) for real error visibility ("por si hay errores"). Alternative:
  ship Fastify JSON logs somewhere searchable.
- **Web analytics (users)**: privacy-friendly, cookieless — **Cloudflare Web
  Analytics** (free, one script tag) or self-host **Umami** on the same VPS.
- **Logs today**: `docker compose -f deploy/docker-compose.prod.yml logs api`
  (add log rotation via Docker's `max-size` logging options in the compose).

---

## 4. Minor debts / cleanup

- **Local dev DB name** is still `minimarket` (docker-compose.yml, .env,
  scripts). Rename to `cervezadonde` for consistency — needs recreating the
  local DB (or `ALTER DATABASE/ROLE ... RENAME`) + updating those files. Prod DB
  is already `cervezadonde`.
- ~~**`ingest:osm`** (old Overpass hours-only enrichment) + the
  `store_osm_enrichment` table~~ **Removed** (migration 1700000000009): the
  canonical pbf ingest writes `opening_hours_osm` directly, so both were dead.
- **Two OSM ingest paths remain by design**: `ingest:osm:region` (Overpass, a
  light path for quick regional tests) and `ingest:osm:pbf` (Geofabrik, the real
  national one). Both share `persistOsmCanonical`; the region one is kept only as
  a fast test harness — drop it too if it ever drifts.
- Confirm `source_name` is uniformly `'osm'` everywhere (standardised).

---

## 5. Opening-hours coverage — the big one (do after 1–4)

The core product gap: only ~14% of stores have hours, so most of the map reads
"horario no confirmado". Full analysis + options already in
[`docs/12-hours-data-sources.md`](./12-hours-data-sources.md). Summary of the plan:

1. ~~**Default-hours heuristic**~~ **DONE**: `DEFAULT_HOURS_BY_TYPE` in
   `apps/api/src/openNow.ts` (standard OSM syntax through the same parser),
   surfaced as `open_now.hours_source: osm|estimated|none` and a distinct
   light-green "suele estar abierto" state in the UI. Never claims
   "confirmado". ⚠ The API container must run with TZ=Europe/Madrid.
2. ~~**Website `schema.org` crawler**~~ **DONE — and measured** (`pnpm
   worker:crawl:hours`, incremental, polite): 9,527 URLs crawled, 281 sites
   (4.3% of reachable) had parseable hours → 290 stores confirmed. Far below
   the hoped-for jump (see docs/12 "Measured"); keep it in the weekly refresh
   but the next real move is the community feedback loop (item 3).
3. **Community feedback loop** → contribute corrections back to OSM.
4. Optional paid API (TomTom/HERE) as a coverage floor.

Rationale for doing it last per the maintainer: the operational/quality
foundation (1–4) should be solid first, then invest in the hardest data problem.

---

## Quick reference — where things live

- Architecture: [`docs/00-overview.md`](./00-overview.md)
- Deploy runbook: [`docs/13-deploy.md`](./13-deploy.md)
- Hours data sources: [`docs/12-hours-data-sources.md`](./12-hours-data-sources.md)
- ADRs: [`decisions/`](../decisions/) (006 = deploy, 007 = OSM-canonical national)
- National ingest: `pnpm worker:ingest:osm:pbf -r spain`
- Publish data: `.\scripts\push-data.ps1`
