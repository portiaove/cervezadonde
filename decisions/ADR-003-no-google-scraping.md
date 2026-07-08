# ADR-003 — No Google Maps Scraping

## Decision

Do not scrape Google Maps or bulk-copy Google Places data into the application database.

## Rationale

The product should be legally and operationally independent. Google data has usage restrictions and should not be the foundation of the dataset.

## Consequences

- Initial coverage may be imperfect.
- Coverage improves through official data, OSM enrichment and community feedback.
- The product remains defensible and reproducible.
