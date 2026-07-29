# 19 · Precision-first data refinement

Status: implemented and applied locally on 2026-07-29; deployed to production
the same day with the refreshed national snapshot recorded in section 9.

This document records the evidence, policy and measured effect of replacing
the proximity-only OSM↔censo merge. It supersedes the serving/matching policy
described in sections 2, 6, 8, 10 and 16 of the project atlas and sections 2–5
of the data-quality atlas. Those documents remain the baseline audit.

## 1. Goal

The optimisation target is **precision before coverage**:

> A missing place is disappointing. A place that the product says exists and
> sends somebody towards, but is gone, destroys trust.

Censos remain useful evidence, but a licence/directory row is no longer enough
to publish a place. No physical rows are deleted.

## 2. Baseline

Before refinement:

| Measure | Value |
|---|---:|
| Physical rows | 230,320 |
| API-visible rows | 207,304 |
| OSM-backed | 169,701 |
| Censo/fixture-only visible | 37,603 |
| `verified` from proximity-only `oficial` | 29,801 |
| Rows with real hours | 29,586 |
| Fixture rows visible | 27 |

The four active censo-only contributions were:

| Source | Visible before |
|---|---:|
| Andalucía IECA | 18,579 |
| Madrid | 7,812 |
| Barcelona city | 6,195 |
| DIBA | 4,990 |

## 3. Why the old cross was unsafe

The old algorithm chose the nearest censo record within 30 m for every active
OSM row. It did not require name, type, address or one-to-one assignment.

Full candidate-pair audit:

| Measure | Value |
|---|---:|
| Candidate pairs within 30 m | 74,106 |
| OSM rows with at least one candidate | 29,800 |
| OSM rows with several censo candidates | 18,463 |
| Censo rows with several OSM candidates | 17,742 |
| Extra OSM→same-censo assignments in old relation | 7,011 |
| Old type mismatches | 5,458 (18.3%) |
| Old exact non-empty name matches | 5,175 (17.4%) |

After removing rows with explicit closure/non-beer evidence, 73,756 candidate
pairs entered the versioned matcher.

Candidate density by source:

| Source | Candidate pairs | OSM with candidate | Pairs/OSM |
|---|---:|---:|---:|
| Andalucía | 21,037 | 9,867 | 2.13 |
| Barcelona city | 23,994 | 8,272 | 2.90 |
| DIBA | 2,533 | 1,457 | 1.74 |
| Madrid | 26,542 | 10,204 | 2.60 |

The densest source, Barcelona city, is exactly where distance-only assignment
is least trustworthy.

### Residual censo-only proximity

Even after the old merge, 8,704 visible censo-only rows remained within 30 m
of active OSM. They are not automatically duplicates; the number demonstrates
how often several businesses/premises share the same small area.

Distance from visible censo-only rows to the nearest active OSM:

| Source | <10 m | 10–30 m | 30–100 m | 100–250 m | ≥250 m/no OSM ≤1 km |
|---|---:|---:|---:|---:|---:|
| Andalucía | 706 | 2,101 | 7,489 | 4,846 | 3,437 |
| Barcelona city | 727 | 2,143 | 2,687 | 627 | 11 |
| DIBA | 91 | 449 | 1,599 | 1,574 | 1,277 |
| Madrid | 523 | 1,964 | 3,574 | 1,436 | 315 |

Closeness describes urban density; it does not establish identity or current
existence.

## 4. New matching policy

Candidate generation still uses a 30 m PostGIS radius, but candidate acceptance
is pure, versioned TypeScript (`censo-match-v2-high-precision`).

### Hard requirements

- active OSM row;
- censo row has a beer-relevant type/intent and no explicit closure signal;
- both normalised names are present;
- neither name is merely a generic category such as `BAR`,
  `SUPERMERCADO` or a phrase composed only of generic category tokens;
- functional types are compatible:
  - `bar` only matches `bar`;
  - `supermercado`, `alimentacion`, `bodega` and `tienda_24h` are compatible
    takeaway taxonomies;
- the pair clears one name/distance rule:
  - exact name, ≤30 m;
  - token Dice similarity ≥0.8, ≤20 m;
  - token Dice similarity ≥0.6, compatible type, ≤10 m.

### One-to-one selection

The evidence rules produce 9,007 qualified pairs. Among them, 73 OSM rows and
156 censo rows still have several plausible partners. Every pair touching one
of those ambiguous rows is rejected; no winner or second choice is selected.
A partial unique index on `(matched_censo_source, matched_censo_local_id)`
enforces the remaining one-to-one result.

### Evidence persisted on the OSM row

- `matched_censo_source`;
- `matched_censo_local_id`;
- `censo_match_version`;
- `censo_match_method`;
- `censo_match_distance_m`;
- `censo_match_name_similarity`.

The `oficial` badge is derived from those fields and rebuilt from scratch.

The censo relation is **evidence, not field ownership**. It no longer copies
address, district, neighbourhood or official status onto the canonical OSM
row. Migration `1700000000012` removes stale values left by the old merge,
including addresses whose provenance cannot be recovered safely; a full OSM
re-ingest restores addresses from OSM itself. At query time, the API
may fall back to address/district from the currently matched censo row when OSM
does not provide that field. Because this is a live join rather than a copy,
rejecting a match removes the fallback without leaving stale data behind.

## 5. Serving policy

Migration `1700000000011` adds:

- `is_published` — explicit API visibility;
- `publication_reason` — why a retained row is hidden;
- the match-provenance fields and constraints.

Public API queries and `/meta` require both:

```sql
is_published AND confidence_level <> 'excluded'
```

Current rules:

| Source/state | Published? | Reason |
|---|---:|---|
| active OSM | yes | canonical source |
| OSM absent from latest full extract | no | `osm_missing_latest_extract` |
| censo matched to OSM | no (OSM row is served) | `matched_to_osm` |
| censo-only | no | `censo_only_unconfirmed` |
| explicit censo closure | no | `censo_source_closed` |
| development fixture | no | `development_fixture` |

`confidence_level` is no longer overloaded as the only visibility control.

## 6. Result

Final local snapshot:

| Measure | Before | After |
|---|---:|---:|
| Physical rows retained | 230,320 | 230,320 |
| Published rows | 207,304 | 169,701 |
| Published non-OSM rows | 37,603 | 0 |
| `verified`/accepted censo matches | 29,801 | 8,568 |
| `mapped` OSM-only rows | 139,900 | 161,133 |
| Published real-hours rows | 29,586 | 29,538 |
| Published fixtures | 27 | 0 |
| Published blank-name rows | 14,043 | 14,043 |

Accepted matches:

| Source | Exact name | Strong name | Name + type | Total |
|---|---:|---:|---:|---:|
| Madrid | 2,146 | 711 | 763 | 3,620 |
| Barcelona city | 2,718 | 566 | 735 | 4,019 |
| DIBA | 343 | 152 | 88 | 583 |
| Andalucía | 13 | 150 | 183 | 346 |
| **All sources** | **5,220** | **1,579** | **1,769** | **8,568** |

The per-source method split is available from persisted fields; totals above
are the stable audit output.

The final audit is idempotent:

- simulated accepted matches: 8,568;
- materialised `oficial` badges: 8,568;
- distinct censo evidence IDs: 8,568;
- badge without provenance: 0;
- provenance without badge: 0.

A real API query around central Madrid returned 132 `mapped`, 68 `verified`
and zero `unverified` results. Local `/meta` returned 169,701 active stores and
29,538 with real hours.

Here `verified` is a backwards-compatible API name for **identity corroborated
by OSM and a censo**. It is not a claim that the premises was physically
checked or that it is open today.

## 7. Commands

Read-only simulation:

```powershell
pnpm worker:audit:censo-matches
```

Apply the reversible serving/matching refinement:

```powershell
pnpm db:migrate
pnpm worker:refine:censo-matches
```

Every full OSM ingest runs the same refinement after stale-OSM pruning.

## 8. Residual risks

This change fixes the known censo-only and proximity-identity failure paths. A
small, deliberately stratified manual check against Google Maps on 2026-07-29
then tested the remaining current-existence risk. Google was used only as a
visual comparison for the sample; no Google data was copied into the dataset.

The first sample contained one match for every censo-source/matcher-method
combination (12 total):

| Manual comparison | Cases |
|---|---:|
| Active-looking business and matching location | 8 |
| Temporarily closed | 2 |
| Permanently closed | 1 |
| Address found but no business listing | 1 |

The sample is intentionally balanced across strata, not random or
population-weighted, so these counts are not an estimate of the national error
rate. They do prove that censo agreement is identity evidence, not a current
existence guarantee.

A second six-case sample selected OSM rows with real `opening_hours`. Four
looked active at the expected location, one was temporarily closed, and one
appeared to have moved while the old OSM point and hours remained. Therefore
an OSM hours tag improves usefulness but is not sufficient currentness proof.

Remaining risks:

- OSM can remain stale until a contributor edits/removes a feature;
- the PBF records OSM presence, not a recent physical visit;
- an exact name can be reused after a business changes hands;
- the OSM beer classification still assumes target amenity/shop tags imply a
  useful beer source;
- 14,043 published OSM rows remain unnamed;
- 82.6% of published rows still lack real hours.

The next evidence improvement should store OSM element version/timestamp,
compare name/address/location against structured data on the business's own
website, and introduce user closure feedback with moderation. Neither should
re-enable censo-only serving without an explicit new evidence policy.

## 9. Production publication

Production publication completed on 2026-07-29 after the full local refresh.
The deployed snapshot passed these checks:

| Measure | Production |
|---|---:|
| Physical rows | 230,819 |
| Published rows | 170,032 |
| Published non-OSM rows | 0 |
| Accepted censo matches | 8,585 |
| Rows with OSM or website hours | 29,696 |
| Import runs | 40 |
| Store activities | 21,942 |
| Orphaned `last_import_run_id` values | 0 |

`/api/health/db` and `/api/meta` responded successfully. Nearby probes in
Madrid, Barcelona, Sevilla and Bilbao each returned a published OSM-backed
result; none returned the backwards-compatible `unverified` tier.

The publication incident that preceded the successful restore exposed two
delivery defects: production did not contain the `import_runs` referenced by
stores, and the PowerShell wrapper ignored a failed `pg_restore` after
truncation. The publication path now includes `import_runs`, checks native exit
codes, and restores all serving data in one validated transaction.

The production checklist remains:

1. review the code/data diff and final audit output;
2. deploy the migrations and worker/API code;
3. run a complete national OSM re-ingest so every canonical address is
   reconstructed from OSM after removing legacy censo enrichment;
4. apply the high-precision censo relation;
5. verify `/api/meta` and re-run the data-integrity audit;
6. probe Madrid, Barcelona, Andalucía and a non-censo region;
7. confirm no API response contains `verification='unverified'`.

Do not publish by manually deleting censo rows. The retained layers are
necessary for reproducibility and future evidence work.
