# ADR-002 — Data Sources

## Decision

Use Madrid open data as the canonical baseline. Use OpenStreetMap only as optional enrichment. Use user feedback as the quality layer.

## Rationale

The Madrid local/activity census is official, structured and city-wide. OSM is useful but uneven. User feedback is needed because the product category is fuzzy.

## Consequences

- Daily ingestion is enough.
- Data provenance must be stored.
- The app should express confidence, not certainty.
