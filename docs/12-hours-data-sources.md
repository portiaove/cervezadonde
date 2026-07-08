# 12 — Opening-hours data sources (research)

Status: research / decision-shaping. 2026-07-08.

## The problem

OSM enrichment (M6g) materialised `opening_hours` onto **~9% of stores**
(bar 9.6%, supermercado 28%, alimentacion 4.1%). Most of the map reads
"horario no confirmado", which blunts the core promise. We need more hours,
without Google (ADR-003).

## Where do opening hours actually live?

There is **no free, authoritative, downloadable registry of opening hours**
— not in Spain, not globally. Hours are *decentralised*: each business
publishes its own, in several places at once:

- its **own website** (increasingly as machine-readable
  `schema.org/OpeningHoursSpecification` JSON-LD);
- its **Google Business Profile** (owners maintain it for free because
  Google sends them customers);
- its **Facebook/Instagram** page;
- **delivery platforms** (Glovo, Uber Eats, Just Eat, TheFork).

Aggregators don't have a secret source — they *rebuild* hours by combining
**owner self-reporting + web crawling + crowdsourced edits + paid data
partners**, then reconciling conflicts by source reliability. That's exactly
how Google Maps does it (owner-verified > official website > aggregators >
user edits). So the honest answer to "they must be somewhere" is: yes — in
each business's own channels, and you assemble them yourself.

## What the open datasets actually give us (verified 2026-07-08)

| Source | License | Has opening hours? | Useful for us |
|---|---|---|---|
| **OpenStreetMap** `opening_hours` | ODbL | **Yes** — the only open hours source | Already used (M6g); ~9% coverage, plateaus |
| **Overture Maps — Places** | Overture/CDLA | **No** — only `operating_status` (open/closed permanently) | Adds `websites`, `socials`, `phones`, brand, names → widens the crawl surface + better matching |
| **Foursquare OS Places** (free, Apache-2.0) | Apache-2.0 | **No** — hours are Pro/Premium (paid) only | 100M+ POIs with `website`, `tel`, socials → same: widens crawl surface |
| **Google Places API** | Google ToS | Yes (owner-submitted) | ❌ Out by principle + ToS (ADR-003) |
| **HERE / TomTom / Foursquare Places API / Yelp** | Commercial | Yes | Paid; caching/display ToS limits. A budget "coverage floor" option |

Key correction to an easy assumption: **neither Overture nor the free
Foursquare dump contains opening hours.** They contain *contact info*
(website, phone, socials) for far more places than OSM has hours for. That
is the lever.

## The realistic strategy (no Google)

### 1. Crawl the businesses' own websites for structured hours — highest leverage

This is precisely what Google does, and it's legitimate: hours are public
factual data the business published for this purpose.

- We already hold a `website`/`contact:website` tag for **2,503** OSM rows
  (vs 1,958 with hours) — and **1,340 matched stores have a website but no
  hours today**: immediately crawlable.
- Broaden website coverage massively by ingesting **Overture + Foursquare-OS
  contact info** and attaching `website`/`phone` to stores that OSM misses.
- Fetch each site, parse `schema.org` `OpeningHoursSpecification` (JSON-LD /
  microdata), normalise to OSM `opening_hours` syntax, store in a new
  provenance table `store_web_enrichment` (same separable-source discipline
  as `store_osm_enrichment`), then materialise onto `stores`.
- Be a good citizen: respect `robots.txt`, cache, low crawl rate,
  conditional requests.

### 2. Community feedback loop — pull it forward from Phase 2

Let users confirm/correct hours in <15s (already in the blueprint). Push
accepted corrections **back to OSM** — a compounding, defensible flywheel and
good citizenship. This is how we eventually beat a static dataset.

### 3. Default-hours heuristic — cheap UX bridge, ship first

Per `place_type`, show a clearly-labelled **"horario habitual estimado"**
(e.g. bar 09:00–24:00, súper 09:00–21:30, 24h always) — never presented as
confirmed, distinct marker state. Turns most of the grey map into a useful
guess while real hours accrue. Low effort, immediate.

### 4. Paid API — optional coverage floor

If we want a fast jump, evaluate **TomTom** or **HERE** (generous free
tiers) for hours, mindful of caching/display ToS. Not required for MVP.

## Recommendation / sequencing

1. **Now (cheap):** default-hours heuristic + show the `website` link in the
   place card so a user can self-serve.
2. **M7 (high leverage):** website `schema.org` hours crawler +
   `store_web_enrichment`; widen websites via Overture/FSQ-OS ingest.
3. **M8 (durable):** community feedback → OSM contribution loop.
4. **Optional:** one paid API as a coverage floor if budget/urgency warrants.

Provenance stays layered end-to-end (`official_madrid` → `osm` → `web` →
`community`), attribution preserved per source (ODbL for OSM, Overture/FSQ
notices, "según la web del local" for crawled hours).

## Sources

- Overture Places guide: https://docs.overturemaps.org/guides/places/
- Overture Places schema: https://docs.overturemaps.org/schema/reference/places/place/
- Foursquare OS Places schema: https://docs.foursquare.com/data-products/docs/places-os-data-schema
- Foursquare OS Places announcement: https://foursquare.com/resources/blog/products/foursquare-open-source-places-a-new-foundational-dataset-for-the-geospatial-community/
- Google Business Profile — how Google sources info: https://support.google.com/business/answer/2721884
- schema.org OpeningHoursSpecification: https://schema.org/OpeningHoursSpecification
