# Browser and API reliability audit · 2026-10-19

This update supersedes the affected behaviour described in atlas sections
9–12 and ADR-004. It does not change precision-first publication or censo
matching policy.

## Initial production evidence (before corrections)

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
- At the initial inspection the local Docker daemon was not running, so no
  refresh or deployment had yet been performed. The user subsequently started
  Docker and authorised publication; the completed work is recorded below.

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

- Code/Caddy deployment and the complete Docker-backed data refresh finished
  on 2026-10-19. An import timestamp describes source processing, not a visit
  or a guarantee that every business and schedule is currently correct.
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

The first local validation passed 229 tests (API 61, web 24, worker 144), full
workspace typechecking and the production build. The former lint baseline was
then resolved: source formatting, a cache-file hashing stream expressed without
an empty generator, and a diagnostic template literal. Cache hashing has its
own integrity regression test. Full-repository `pnpm lint` now passes and is
required before deployment. Runtime caches/logs are excluded explicitly. The
refresh PowerShell script parses without errors and `git diff --check` passes.

The static map-engine import produces one ~995 kB JS file (~280 kB gzip), which
triggers Vite's chunk-size warning. This accepts a small initial bundle cost to
avoid a separate late map-engine fetch; it does not introduce a new duplicate
copy of the engine.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` for workspace
validation. Regression coverage includes blocked storage, stalled startup,
out-of-order requests, failed API retry, alternate tiles, wide-zoom open-now,
idle-tab refresh, search cancellation, request timeout, honest labels, HTTP
booleans, invalid/unknown schedules, Canary time/date, DST repeated hours and
Madrid polygon membership. The historical lint baseline documented in the
atlas is resolved by this update.

Further operational validation is recorded below after deployment and refresh.
The reusable `apps/api/scripts/smoke.ts` checks HTTP contracts, publication,
policy scope, filters, clusters and geographic coverage against a running API.
The first local run passed the five mainland/Balearic probes. Canary probes
were then added to prevent the confirmed missing-coverage issue returning.

Source: [Geofabrik Spain coverage note](https://download.geofabrik.de/europe/spain.html)
and [separate Canary Islands extract](https://download.geofabrik.de/africa/canary-islands.html).

## Production validation and data renewal

Code commits `735b0c1` and `7011f5d` deployed successfully through GitHub Actions
on 2026-10-19. The final deployed code is `bb4f53d`, including crawler source
exclusions. Its [deployment workflow](https://github.com/portiaove/cervezadonde/actions/runs/39246249709)
passed tests, types, full lint, web build and deployment. All 233 automated
tests (API 61, web 24, worker 148), workspace typechecking, lint and build also
passed locally. An intermediate formatting-only CI failure was corrected
before deployment. Caddy now serves the index with revalidation, hashed assets
as immutable, and missing scripts as 404. The prior MapLibre chunk remains
available for cached clients.

The four censos and combined national OSM import succeeded locally (runs
47–51). The main snapshot was then restored atomically in production:

| Check | Renewed snapshot |
|---|---:|
| Physical retained places | 245,305 |
| Published OSM-backed places | 183,378 |
| Published non-OSM places | 0 |
| Canary places (previously 0) | 11,099 |
| Places with supplied OSM or website hours | 33,866 |
| High-precision official matches | 8,676 |
| Vanished OSM rows retained but unpublished | 906 |
| Duplicate matches / missing provenance / orphan references | 0 |
| Retained import runs / activity rows | 45 / 22,356 |
| OSM import time | 2026-10-19T11:26:13.539Z |

The real HTTP smoke suite passed in both local and production environments:
Madrid, Barcelona, Sevilla, Bilbao, Palma, Tenerife, Las Palmas, Ceuta and
Melilla. The final public smoke and production SQL audit passed again at
11:58 UTC after the final hours publication, with the counts above and zero
publication/provenance/matching integrity violations. It also validated map
filters, clusters, assets, cache headers, 404 handling, a valid CARTO PNG/CORS
response and Photon search. A GPU/browser render check is still unavailable
because no browser is connected.

Recovery copies were retained at `logs/backups/before-refresh-20261019.dump`
locally and `/root/cervezadonde/logs/backups/before-reliability-20261019.dump`
on the VPS.

Website-hour checks are incremental. The original full refresh was deliberately
stopped during its hours phase after approximately 1,000 URLs so that the
crawler could resume with corrected Google Maps country-domain and redirect
exclusions. Public business pages hosted on Google Sites remain allowed.
Three regression tests cover those source boundaries. The resumed crawl uses
24 parallel origin hosts with the existing per-host sequential processing and
delay. The first refresh transcript records that controlled interruption, not
an OSM/censo import failure. The resumed crawl completed successfully (exit 0)
and checked all 8,510 queued URLs: 5,856 fetched, 2,465 fetch errors and 189
robots exclusions. It extracted valid hours from 443 websites, updated 450
places and found no invalid extracted schedules. Unreachable sites are not
treated as verified and do not get invented schedules. The 183 remaining
due URLs are exactly the intentional brand/host exclusions (60 + 123), not an
unfinished queue. See `logs/hours-resume-20261019-133834.log` for the run.

The final data push completed successfully in a validated transaction before
the final public checks. Recovery copies were retained. Temporary local API
and static audit services are stopped after validation; the user's Docker
engine and database are left running.
