# Place evidence and moderated corrections · 2026-10-19

This supersedes category-default schedules and the fuel/retail inference in
documents 17–20. OSM/censo identity policy remains precision-first.

## Product rule

Unknown is not open or closed. Only a usable place-specific OSM schedule,
an identity-matched website schedule observed within 180 days, or a reviewed
time-limited correction can enter open-now. The API adds `open_now.status`
(`open`, `closed`, `unknown`); the legacy boolean `open=false` for unknown is
not evidence of closure. `estimated` remains only for old-client compatibility
and is never emitted. The web renders legacy estimated states as unconfirmed.
No automatic estimated fallback is recommended when a reliable option is absent.

Beer availability is a separate dimension: `documented` means an explicit OSM
beer tag, `likely` is category inference, `unknown`/`no` cannot be recommended.
None guarantees stock or a live visit. Raw tags, policy version and original
OSM object-edit timestamp are retained; import time is not an observation.
Having hours no longer upgrades beer-classification confidence.

Fuel POIs need a recognised retail shop or explicit beer evidence to be
eligible. `shop=no`, explicit no-beer/no-alcohol and private/inactive evidence
take precedence. Pump hours never establish shop hours; reviewed shop hours
are required on a combined fuel POI. Separately mapped convenience shops remain
normal shop candidates; neighbouring shops are not merged by distance.

## Serving and durable evidence

`serving_stores` is the common visibility boundary for nearby, map, clusters
and metadata. It excludes unsupported beer candidates and active reviewed
negative corrections. A wrong-hours correction keeps the place visible but
its hours unknown until corrected. Disagreeing evaluable OSM/web schedules
yield unknown at the requested instant; malformed values do not mean closed.

`place_reports` and `place_corrections` belong to production, not the PC's
regenerated snapshot. They use source name + source-local ID + normalised
business name, never a foreign key to the replaceable `stores.id`. Reusing or
renaming the same OSM feature therefore does not apply the old name's closure
to the new business. A same-name replacement still needs human review.

Reports carry no email, photos, coordinates or free-text personal details.
The API accepts a small, strict JSON kind, only from the configured web origin,
with a 1 KB limit, five requests/IP/10 minutes and a bounded in-memory budget.
No IP is stored in the reports table; existing server access logs still apply.
One pending report per identity/kind is retained. Anonymous reports NEVER
automatically change a place. Moderation is SSH/CLI-only; no admin credential
or moderation endpoint is exposed in the browser.

Kinds are closed now, permanently closed, no beer and wrong hours. A reviewed
closed-now observation lasts four hours from submission, not from review;
expired reports cannot be accepted as a current closure. Permanent negatives
are not silently undone by another import. Revocation records a reason.
Reviewed hours expire after at most 180 days (90 by default).

## Operations

List pending reports on the VPS:

```sh
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod run --rm -T api pnpm --filter @cervezadonde/worker run reports:list
```

With that same command prefix, review one with:

```sh
pnpm --filter @cervezadonde/worker run reports:review ID accept --reviewer NAME --note 'Evidence supporting this decision'
pnpm --filter @cervezadonde/worker run reports:review ID reject --reviewer NAME --note 'Insufficient or contradictory evidence'
pnpm --filter @cervezadonde/worker run corrections:hours SOURCE_ID 'Mo-Sa 10:00-22:00' --days 90 --reviewer NAME --note 'Exact branch/source and observation date'
pnpm --filter @cervezadonde/worker run corrections:revoke CORRECTION_ID --reviewer NAME --note 'Reason'
```

Do not accept a report without reviewing its evidence. Do not turn an ordinary
closed-now observation into a permanent closure. Hours corrections must refer
to public service/shop hours, not reservations, kitchens or fuel pumps.

Snapshot publication now uses `TRUNCATE … RESTRICT`, never cascading to future
tables, validates evidence counts and backs up both evidence tables first via
`deploy/backup-quality.sh`. Run that helper for an additional evidence backup;
full-database recovery copies are also retained before this deployment. These
copies are local to the VPS, not an off-site disaster-recovery service. No new
scheduled job or off-site backup service is configured by this change.

The website crawler matches business name plus address or coordinates before
extracting only that entity's own hours. It rejects shared branch URLs,
contradictory entities and unrelated reservation/department schedules. Attempt
time, check-policy version and successful observation time are distinct. Old
hours remain retained but unconfirmed when identity cannot be checked, and
fetch failure does not refresh the age of a previously observed schedule.
Changing an OSM website invalidates the old website observation.

## Baseline and validation

Before this change: 183,378 published backbone records, 149,512 without any
supplied hours, 7,245 fuel candidates admitted by hours rather than a recognised
shop on that same feature. These are risk counts, not a measured false-positive rate.

The current cached national inputs yielded 188,167 retained candidates and
updated evidence for 183,382 existing rows, without inserting/pruning or
changing OSM processing dates. All 245,305 physical rows remain. The serving
view initially contains 176,066 places, including 56 retail-supported fuel POIs
(which still need shop-specific hours for open-now).

Tower Paradise (`n9450850755`, row 70654) has no own hours: unknown, grey,
excluded from open-now, not labelled permanently closed. Francos Rodríguez 75
(`a1320501512`, row 1046545) has no retail evidence: retained but not served.
No external contradictory hours were copied onto either case.

`pnpm test:quality-db` creates a generated isolated schema in a localhost DB,
checks real HTTP queries, pending-report isolation/deduplication, moderation,
negative-evidence survival after snapshot-shaped replacement, rename isolation,
expiry and wrong-hours handling, then removes only that schema. Public-table
counts are checked unchanged. The same test and all migrations are now a CI
deployment gate against an ephemeral PostGIS service.

Local validation passes 253 unit/component tests (API 74, web 27, worker 152),
full typechecking, lint and the workspace production build. Real API probes
pass in nine cities. Local metadata now counts 176,066 serving candidates and
26,123 with a supplied usable-source schedule (still not a live confirmation).
The stricter website run checked 507 URLs: 496 fetched, 11 failed, 85 matched
business-specific schedules updated; 422 had no accepted schedule. No invalid
hours were stored. A clean, empty PostGIS bootstrap also passes every migration
and the isolated HTTP/moderation/snapshot test. The latter exposed an enum
transaction issue during development; the new migration compares the legacy
fuel type as text so full bootstrap is safe too.

## Production handoff

Implementation commits `c65d22a`, `5b0f383`, `c2fc612` and restore correction
`4232153` are pushed to main. Production was checked at 16:06 UTC on
2026-10-19: 176,066 API-visible candidates and 26,123 with a usable-source
schedule, with all 245,305 physical rows retained. The full public HTTP smoke
passes in all nine cities, serves the current OSM-only web assets and validates
the report POST route with an invalid payload (400; no artificial public report
was inserted). Tower Paradise is explicitly unknown and absent from open-now;
the unsupported Francos Rodríguez 75 fuel record is absent from public results.

GitHub [reported an Actions/Pages incident](https://www.githubstatus.com/)
from 15:49 UTC; its run metadata continued to report queued jobs even while
the server had already received the revision. Rather than claim a green CI
result from those inconsistent statuses, publication was verified using the
documented manual SSH procedure and the equivalent completed local gates,
including empty-PostGIS bootstrap and actual canonical-ingest integration.
The final queued Actions run is
[39282697055](https://github.com/portiaove/cervezadonde/actions/runs/39282697055).
Its future execution is idempotent; no CI success is asserted here.

The first data-publication attempt rolled back at the new evidence guard:
pg_dump clears `search_path`, so the guard's unqualified table references could
not resolve. The prior catalogue and evidence were preserved. `4232153`
schema-qualifies the guard, and the integration test now executes the actual
production guard after clearing search_path. The repeat publication completed
with `COMMIT` (45 imports, 245,305 stores, 22,356 activities).

Full recovery copies remain at `logs/backups/before-evidence-20261019.dump`
locally and `/root/cervezadonde/logs/backups/before-evidence-20261019.dump`
on the VPS. The VPS also retained the automatic evidence archives from both
publication attempts. Temporary test schemas and the disposable clean-DB
container were removed; the local API/watch helper is stopped at handoff and
the user's original PostgreSQL/Docker remain running.

Tests of software behaviour do not establish the physical accuracy of every
shop; further category/region-stratified field review remains
necessary. Ambiguous cafe/restaurant/kiosk category inference is still labelled
likely, not verified; this update does not pretend the whole catalogue has
been individually checked.
