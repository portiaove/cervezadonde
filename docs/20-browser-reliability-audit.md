# Browser and API reliability audit · 2026-10-19

This update supersedes the affected behaviour described in atlas sections
9–12 and ADR-004. It does not change precision-first publication or censo
matching policy.

## Production evidence

- Home, current JS/CSS, lazy MapLibre chunk, CARTO tile and map/cluster API
  probes returned HTTP 200. This rules out a continuous total outage at audit
  time, but does not reproduce the user's exact browser failure.
- A deliberately nonexistent `/assets/missing-reliability-probe.js` returned
  HTTP 200 with `Content-Type: text/html`, confirming the unsafe SPA fallback
  for missing scripts. Together with deleted old chunks, this is a concrete
  failure path for cached pages; it is not proof of the user's exact cause.
- `/api/meta` reported 170,032 places, 29,696 with supplied hours and the last
  OSM import at `2026-07-29T13:16:55.388Z`. Import time is not a physical visit
  or a guarantee of business currentness.
- The connected browser inventory was empty. Automated React component tests
  exercise real application hooks with a mocked map engine; they are not a
  visual or WebGL end-to-end test.
- The local Docker daemon was not running. No database refresh, migration,
  data publication, code push or production deployment was performed.

## Corrections

1. Reading the `localStorage` property itself is protected. A blocked getter
   previously threw before the boot fallback timer, leaving an empty page.
2. The map engine is a static import. Startup/render errors and a startup
   timeout produce a retry action; a CARTO source failure switches to standard
   OSM raster tiles. The CSS keeps a `100vh` fallback for older browsers.
3. Viewport and nearby requests abort older requests and ignore their late
   results/errors. Requests have a 15-second network timeout. Failures no
   longer masquerade as an empty search area.
4. The visible tab refreshes time-dependent data every minute and when it
   becomes visible. Selected place hours are reconciled with fresh responses.
5. At wide zoom, enabling open-now requests filtered point results instead of
   showing unfiltered cluster counts. Point responses remain a capped sample
   of up to 2,000 candidates, not an exhaustive national count.
6. Estimated closures and nearest/closing-time labels explicitly say they are
   estimates. Empty names get a functional fallback. The time chip displays
   place-region time, not a Spain-wide sale permission. Import freshness is
   labelled as an OSM import rather than an on-site verification.
7. Search invalidates in-flight results immediately when text changes and
   clears pending debounces when closed/unmounted. Network errors differ from
   no search results.
8. HTTP `false` flags stay false; invalid boolean strings return 400.
9. Invalid or explicitly unknown hours mean unconfirmed, not closed. Valid
   website hours can replace unreadable OSM hours. The next parser transition
   is called a closing time only when it actually changes to closed.
10. Each place uses its own peninsula/Balearic or Canary wall clock. The API
    process is UTC so synthetic wall-clock dates do not fall into server DST
    gaps. Solar schedules remain unconfirmed until a timezone-aware solar
    evaluator is provided; they must not use Madrid sunrise nationwide.
11. The Madrid general sale restriction is 22:00–08:00 and uses an actual
    municipal polygon. Other areas carry `sale_policy='unknown'`; open results
    there indicate schedule-based candidates and explicitly disclose that
    local sale rules have not been evaluated. The backwards-compatible
    `ordinance.takeaway_allowed` is now nullable outside the checked area,
    and `scope` identifies the general rule. This is a contract correction.
12. Deploys retain prior hashed assets, upload dependencies before publishing
    the index atomically, and run tests/typechecking before upload. Missing
    assets return 404 instead of SPA HTML. The default API path is same-origin
    `/api`, with a development proxy.
13. A limited Madrid ingest skips missing-row deactivation; an empty ingest
    fails safely. The refresh script waits for healthy PostGIS, migrates, and
    downloads censos afresh. Edition-pinned sources still retain their source
    edition; re-downloading does not magically make an old census current.
14. The full-country OSM import combines the Geofabrik Spain and Canary
    Islands extracts. The original Spain extract excludes Canarias, which
    explains the zero Canary rows found in the July snapshot. Both inputs
    must finish before any national persistence/pruning. The import stores
    both source URLs and a combined hash, and logs each component hash.
15. Caddy is recreated during deploy because Git can replace the file inode
    behind its single-file bind mount; reloading that mount can read stale
    configuration. API Docker images exclude environment files and runtime
    datasets/backups.

## Geographic and rule sources

- [Ley 5/2002, article 30.4 (consolidated BOE)](https://www.boe.es/buscar/act.php?id=BOE-A-2002-14844#a30):
  general night window, local-policy precedence and convenience-licence
  exceptions. Retrieved 2026-10-19.
- [Madrid instruction](https://sede.madrid.es/portal/site/tramites/menuitem.5dd4485239c96e10f7a72106a8a409a0/?version=true&vgnextchannel=6b3d814231ede410VgnVCM1000000b205a0aRCRD&vgnextoid=8c837b3cb0e4f010VgnVCM1000009b25680aRCRD):
  municipal reference to the 22:00–08:00 window. Licence exceptions cannot be
  inferred from a place merely having `opening_hours=24/7`.
- [IGN administrative unit](https://api-features.ign.es/collections/administrativeunit/items?f=json&nameunit=Madrid&nationallevelname=Municipio&limit=1):
  municipality `34132828079`, feature `1173581`, retrieved 2026-10-19. Geometry
  and attribution are retained in `apps/api/src/data/madrid-municipality.json`.
  This is the municipality of Madrid, not the whole autonomous community.

## Remaining operational/data limits

- Production still needs this code/Caddy deployment and a complete refresh
  using the local Docker-backed pipeline. These changes do not refresh the
  July snapshot on their own.
- A browser/WebGL check is still required in the affected browser and on a
  mobile viewport. Component tests cannot verify GPU support or tile drawing.
- There is no comprehensive local-law/licence registry. The Madrid rule is
  deliberately labelled general and may have licence exceptions. Unknown
  policy elsewhere must not be described as legal approval.
- OSM can retain closed businesses, and most places lack supplied schedules.
  No censo proximity match or automatic import proves current existence.
- Existing nearby/map candidate limits and holiday-calendar context remain
  limitations: nearby scans the first 200 candidates for open-now and map
  filters a capped sample; regional holiday calendars may be incomplete.

## Validation

Final local checks: **229 tests passing** (API 61, web 24, worker 144), full
workspace typecheck passing, and production web build passing. Modified source
files pass Biome. Full-repository lint retains existing errors and
one warning in untouched files. The refresh PowerShell script parses without
errors and `git diff --check` passes.

The static map-engine import produces one ~995 kB JS file (~280 kB gzip), which
triggers Vite's chunk-size warning. This accepts a small initial bundle cost to
avoid a separate late map-engine fetch; it does not introduce a new duplicate
copy of the engine.

Run `pnpm test`, `pnpm typecheck`, a production web build, and lint on modified
source files. Regression coverage includes blocked storage, stalled startup,
out-of-order requests, failed API retry, alternate tiles, wide-zoom open-now,
idle-tab refresh, search cancellation, request timeout, honest labels, HTTP
booleans, invalid/unknown schedules, Canary time/date, DST repeated hours and
Madrid polygon membership. The full lint baseline has unrelated existing
failures documented in the atlas.

Further operational validation is recorded below after deployment and refresh.
The reusable `apps/api/scripts/smoke.ts` checks HTTP contracts, publication,
policy scope, filters, clusters and geographic coverage against a running API.
The first local run passed the five mainland/Balearic probes. Canary probes
were then added to prevent the confirmed missing-coverage issue returning.

Source: [Geofabrik Spain coverage note](https://download.geofabrik.de/europe/spain.html)
and [separate Canary Islands extract](https://download.geofabrik.de/africa/canary-islands.html).
