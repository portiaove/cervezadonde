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

We already do this for Madrid: `ingest:madrid` → `source_name='madrid_censo'`,
then `enrichWithCenso` merges official fields onto the matched OSM store and
flags `oficial` (see [ADR-007](../decisions/ADR-007-national-osm-primary.md)).

To extend to other cities:
- **Generalise the merge.** `enrichWithCenso` (in
  `apps/worker/src/ingest-osm-canonical.ts`) hardcodes
  `source_name = 'madrid_censo'`. Make it match against **any** official source
  (e.g. `source_name LIKE 'censo_%'`).
- **One adapter per city** (each open-data portal has its own schema): download
  + parse + map to the `stores` shape under `source_name='censo_<city>'`, same
  as `ingest-madrid.ts`. Candidates with usable open data: **Barcelona**
  ("Cens d'activitats econòmiques en planta baixa"), **Valencia**, **Zaragoza**,
  **Málaga**, **Sevilla**.
- This is **incremental polish**: OSM already covers these cities; the censo
  only adds the official confirmation + richer address/status.
- Decide per city whether the adapter effort is worth the quality gain.

---

## 3. Operations & observability

### 3a. Weekly data refresh (automate)
Today it's manual: `ingest:madrid` → `ingest:osm:pbf -r spain` → `push-data.ps1`.
- Wrap in one script `scripts/refresh-all.ps1` and schedule it with **Windows
  Task Scheduler** (weekly). Document the exact task.
- The Geofabrik Spain extract updates ~monthly, so weekly is plenty.

### 3b. Backups
- **Data is regenerable** from the PC pipeline, so the VPS DB isn't precious
  *yet*. That changes the moment **user feedback** (Phase 2) lands — then the
  feedback table must be backed up.
- Cheap wins now: enable **Hetzner automatic backups/snapshots** (~1 €/mo) for
  the whole VPS; keep the last few `serving.dump` files locally.
- Later: a nightly `pg_dump` on the VPS to an offsite bucket (only needed once
  there's non-regenerable data).

### 3c. Monitoring & logs
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
- **Two OSM ingest paths coexist**: `ingest:osm:region` (Overpass, prototype)
  and `ingest:osm:pbf` (Geofabrik, the real one). Decide whether to keep the
  Overpass one for tiny tests or remove it.
- **`ingest:osm`** (the old Overpass *hours-only* enrichment onto Censo) and the
  `store_osm_enrichment` table are largely legacy now that the pbf path makes
  OSM canonical with hours built in. Clarify their role or deprecate.
- Confirm `source_name` is uniformly `'osm'` everywhere (standardised this
  session).

---

## 5. Opening-hours coverage — the big one (do after 1–4)

The core product gap: only ~14% of stores have hours, so most of the map reads
"horario no confirmado". Full analysis + options already in
[`docs/12-hours-data-sources.md`](./12-hours-data-sources.md). Summary of the plan:

1. **Default-hours heuristic** per `place_type` (labelled "horario habitual
   estimado", never "confirmado") — cheap bridge that de-greys the map now.
2. **Website `schema.org/OpeningHoursSpecification` crawler** — the real
   coverage jump; we already hold ~websites via OSM, widen with Overture/FSQ.
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
