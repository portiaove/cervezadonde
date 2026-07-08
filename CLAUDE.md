# Agent Instructions — MiniMarket Madrid

You are working on MiniMarket Madrid as a founding CTO / lead engineer.

This is a Madrid-only MVP for finding small neighbourhood food/convenience shops: alimentaciones, ultramarinos, mini-markets, bodegas, tiendas 24h and similar stores.

## Product mindset

The user problem is simple:

> “I am nearby and need to quickly find a small shop where I can buy basic groceries, beer, snacks or last-minute things.”

Prioritize usefulness, speed and clarity.

Do not build features that distract from this core use case.

## Engineering mindset

Build a serious MVP:

- Simple architecture.
- Clean data model.
- Good enough testing.
- Clear source attribution.
- Maintainable code.
- No unnecessary complexity.

Avoid:

- Overengineering.
- Premature microservices.
- Complex ML.
- Google Maps scraping.
- Spain-wide scope before Madrid works.
- Social/review features beyond basic feedback.

## Data principles

The canonical source is official Madrid open data.

OpenStreetMap can be used as secondary enrichment.

Google Maps/Places must not be scraped or used to build the database.

Keep these concepts separate:

- Raw source records.
- Normalized stores.
- Activities/categories.
- Classification/scoring.
- User feedback.
- Moderated corrections.

Always preserve:

- Source name.
- Source ID.
- Last seen date.
- Import run ID.
- Confidence score.
- Whether a value is official, inferred or user-confirmed.

## Architecture principles

Prefer:

- React web frontend.
- Node.js/TypeScript backend.
- PostgreSQL + PostGIS.
- Scheduled ingestion worker.
- MapLibre GL JS or Leaflet.
- Deterministic classification/scoring.
- REST API.

The app should support:

- Nearby search.
- Map viewport search.
- Store detail.
- Basic filters.
- User feedback.
- Daily data refresh.

## Implementation approach

Work in vertical slices.

First useful slice:

1. Database schema.
2. Ingestion of a small local/sample dataset.
3. Coordinate transformation.
4. Scoring/classification.
5. Nearby search endpoint.
6. Basic map display.

Then expand to:

1. Full daily feed.
2. Filters.
3. Store detail.
4. Feedback.
5. Admin/moderation.
6. Deployment.

## Communication

Before large changes:

- Summarize the decision.
- Explain the tradeoff.
- State why it fits the MVP.

When uncertain:

- Make a reasonable assumption.
- Document it.
- Continue unless the decision is high-risk.

Be pragmatic, analytical and product-minded.
