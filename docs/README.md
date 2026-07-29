# Documentation map

This directory contains several generations of the product. Read it with an
explicit authority order so an old Madrid-only plan does not override the
Spain-wide system that is actually running.

## Start here

| Document | Role | Authority |
|---|---|---|
| [`19-data-reliability-refinement.md`](./19-data-reliability-refinement.md) | Precision-first serving, high-confidence matching and measured before/after | **Current data-serving policy** |
| [`17-project-atlas.md`](./17-project-atlas.md) | Current product, architecture, flows, API, operations, risks | **Canonical orientation** |
| [`18-data-quality-atlas.md`](./18-data-quality-atlas.md) | Truth model, empirical audit, false-positive paths, investigation queries | **Canonical data-quality reference** |
| [`16-existence-confidence.md`](./16-existence-confidence.md) | Historical censo-only fallback UX | Superseded by document 19 |
| [`13-deploy.md`](./13-deploy.md) | Production topology and manual operations | Current with caveats listed in the atlas |
| [`15-observability.md`](./15-observability.md) | Logs, analytics, uptime and recovery | Current operations reference |
| [`12-hours-data-sources.md`](./12-hours-data-sources.md) | Hours research and measured website-crawl yield | Current research record |

For executable truth, use this order:

1. migrations and running code;
2. shared Zod schemas in `packages/shared`;
3. document 19 and the current atlas documents above;
4. accepted ADRs;
5. older product and delivery plans.

## Document generations

| Document | Best use today | Caveat |
|---|---|---|
| `00-overview.md` | Earlier architecture narrative and diagrams | Still mentions Madrid-only inputs and the removed `store_osm_enrichment` table |
| `01-product.md` | Original product thesis and tone | Madrid-only; feedback and several screens are not implemented |
| `02-data-strategy.md` | Original censo/OSM reasoning | Superseded by OSM-canonical ADR-007 and four censo adapters |
| `03-architecture.md` | Original target architecture | Contains planned tables/endpoints that do not exist |
| `04-domain-model.md` | Vocabulary for `place_type` and confidence axes | Entity list and provenance model are partly stale |
| `05-api-contract.md` | Endpoint reference | Mostly current; examples contain non-existent fields and some defaults differ from schemas |
| `06-ingestion-pipeline.md` | Historical Madrid pipeline | OSM flow is obsolete; national PBF flow is authoritative |
| `07-scoring-classification.md` | Madrid `v2-beer` scorer | Does not describe the simpler OSM/censo-adapter classifiers |
| `08-ux-map-legend.md` | Marker language and place-card concepts | Some described controls/copy are not implemented; current hollow-marker behavior lives in uncommitted work too |
| `09-legal-data-governance.md` | Principles and Madrid ordinance | National geographic dispatch and current third-party browser calls are not covered |
| `10-delivery-plan.md` | Project history | Phases and counts are historical |
| `11-runbook.md` | Useful commands and SQL ideas | Contains stale cadence, source list, cache paths, and an unsafe `--limit` suggestion |
| `12-hours-data-sources.md` | Hours-source research | Measured snapshot, not a guaranteed roadmap |
| `13-deploy.md` | Production runbook | Current atomic serving-snapshot publication |
| `14-roadmap.md` | Handoff/history and accumulated ideas | Counts and “next” ordering are snapshots, not approved priorities |
| `15-observability.md` | Current ops design | Some external setup is manual and cannot be inferred from the repo |
| `16-existence-confidence.md` | Historical censo-only fallback UX | Superseded by document 19; `unverified` is retained only for API compatibility |

The censo-only fallback and proximity-only `verified` policy in documents 16–18
was superseded on 2026-07-29 by document 19 and ADR-008.

## ADR status map

| ADR | Status today |
|---|---|
| ADR-001 stack | Active |
| ADR-002 Madrid censo canonical | **Superseded by ADR-007** |
| ADR-003 no Google scraping | Active |
| ADR-004 Madrid ordinance | Active for Madrid; current national dispatch is incomplete |
| ADR-005 OSM hours | Principle active; Overpass/enrichment-table implementation superseded by ADR-007 and migration `0009` |
| ADR-006 local pipeline + single VPS | Active |
| ADR-007 OSM national canonical | Active |
| ADR-008 precision-first censo serving | Active |

Historical documents are valuable: they explain why the system evolved. They
are not deleted or silently rewritten into a history that never happened.
