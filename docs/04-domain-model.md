# 04 — Domain Model

## Core entities

### Store

A place where beer can be obtained. Bar, shop, or both.

Important fields:

- `id`
- `source_local_id`
- `source_name`
- `name`, `normalized_name`
- `address`, `postal_code`, `district`, `neighbourhood`
- `geom geometry(Point, 4326)`
- **`place_type`** — enum: `bar`, `supermercado`, `alimentacion`, `bodega`,
  `tienda_24h`, `otro`
- **`sells_takeaway_beer`** — boolean (inferred from epigraph / OSM / community)
- **`sells_onsite_beer`** — boolean (true for bars and cafés)
- **`opening_hours_osm`** — text, raw OSM `opening_hours` syntax, nullable
- `confidence_score`, `confidence_level`, `scoring_version`
- `is_chain` — informational only; never an automatic exclusion
- `badges` — text[]
- `official_status` — from Censo (`Abierto`, `Cerrado`, …)
- `last_seen_in_official_source_at`
- `last_seen_osm_at`
- `last_import_run_id`
- `created_at`, `updated_at`

### StoreActivity

Unchanged. One row per (store, epigraph). Used for scoring traceability.

### StoreOsmEnrichment (new)

OSM-derived data kept separable for licensing.

Fields:

- `id`
- `store_id` — FK to `stores`
- `osm_id`, `osm_type` (`node` | `way` | `relation`)
- `opening_hours_raw` — verbatim OSM string
- `name_osm`, `address_osm`
- `matched_by` — `name` | `spatial` | `both`
- `match_distance_m`
- `last_fetched_at`

### ImportRun

Unchanged. Per-ingestion-execution metadata.

### StoreFeedback

Same shape as before. New `feedback_type` values:

- `still_serves`
- `closed_now`
- `wrong_hours` (with optional `value` carrying the user-reported hours)
- `not_a_bar`
- `not_a_shop`

Existing values still apply (`still_open`, `closed_or_missing`,
`sells_drinks`, `sells_cold_beer`, `opens_late`, `is_24h`,
`wrong_location`).

### StoreOverride

Unchanged. Admin/manual correction layer with highest display priority.

## place_type taxonomy

A canonical, functional classification. Derived in the scorer from epigraph
+ OSM tags + rotulo.

| Value | Typical signals |
|---|---|
| `bar` | Epigraph 561001/2/4/5, OSM `amenity=bar|pub|cafe`. |
| `supermercado` | Known chain rotulo, epigraph 471101, large floor area when known. |
| `alimentacion` | Epigraph 471101/3/4, 472911, rotulo contains "ALIMENTACION", "ULTRAMARINOS". |
| `bodega` | Epigraph 472502, rotulo contains "BODEGA". |
| `tienda_24h` | Epigraph 471103, rotulo contains "24H" or "24 HORAS", or OSM `opening_hours=24/7`. |
| `otro` | Has a target epigraph but doesn't match any of the above. |

## Confidence levels (reinterpreted for the beer use case)

- `high`: clear place_type + recent confirmation + opening_hours present.
- `medium`: plausible category, missing hours OR no community confirmation.
- `low`: weak signal, hidden by default.
- `excluded`: officially closed, invalid coords, or hard-excluded category.

Chain status no longer drives exclusion. A Mercadona is `high` confidence
and `is_chain = true`.

## Existence confidence (`verification`) — a separate axis

`confidence_level` says "how sure are we of the *classification*"; it says
nothing about whether the place still physically exists. That is the
**`verification`** axis (API-derived, not stored): `verified` (in OSM +
confirmed by an official censo) | `mapped` (in OSM only) | `unverified`
(censo-only — a licence register lags real closures by months/years, so these
are single-source and unconfirmed). It gates the "nearest open" ranking and the
hollow-marker rendering. Full rationale: [docs/16](./16-existence-confidence.md).

## Badges

Display-layer flags. Order matters for UI rendering — first applicable wins.

- `bar`, `supermercado`, `alimentacion`, `bodega`, `tienda_24h`
- `abierto_ahora`, `cierra_pronto` (closing in ≤ 30 min)
- `horario_no_confirmado`, `posible_cerrado`
- `verificado`
- `vende_cerveza_para_llevar`, `vende_cerveza_in_situ`
- **`no_puede_vender_ahora`** — Madrid alcohol ordinance applies right now
  (see ADR-004)

## Provenance rule (unchanged)

```
display_store = official_madrid
              + osm_enrichment
              + inferred_scoring
              + community_consensus
              + admin_override   (highest priority)
```

Layers never overwrite each other in storage. The display object is
computed at read time.

## Open-now derivation

Computed server-side by the API given `now` (Europe/Madrid), the place's
`place_type`, and its `opening_hours_osm`:

```
isOpenNow(opening_hours_osm, now) → { open: bool, closesAt: time | null }

canSellBeerNow(place, now) =
  isOpenNow(place.hours, now).open
  AND (
    place.place_type == 'bar'                          // on-site, always allowed when open
    OR (
      place.sells_takeaway_beer
      AND not isAlcoholTakeawayProhibited(now)         // ADR-004
    )
  )
```

The Madrid ordinance window (22:00 → 09:00 Europe/Madrid) is a single,
testable boolean. See ADR-004 for the legal basis.
