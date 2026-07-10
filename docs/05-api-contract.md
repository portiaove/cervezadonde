# 05 — API Contract

## API principles

- Keep the API small.
- Optimise for nearby + open-now.
- Compute open-now server-side from `opening_hours_osm` + current
  Europe/Madrid time + the Madrid alcohol ordinance (ADR-004).
- Return enough data for fast map rendering, full provenance only in details.

## Public endpoints

### GET `/health`

Returns API status. Companion: `/health/db` confirms PostGIS connectivity.

### GET `/stores/nearby`

Find the nearest places that can serve or sell beer.

Query params:

- `lat` (required, number)
- `lng` (required, number)
- `radius_m` (optional, default 1000, max 5000)
- `limit` (optional, default 50, max 200)
- `place_type` (optional, comma-separated: `bar,supermercado,alimentacion,bodega,tienda_24h`)
- `intent` (optional: `consume_aqui` | `para_llevar`) — convenience filter
  combining place_type + alcohol-ordinance check
- `open_now` (optional boolean, default true) — enforce open-now + ordinance
- `min_confidence` (optional: `high|medium|low`, default `medium`)
- `hide_chains` (optional boolean, default false)
- `at_time` (optional ISO time, default `now`) — for testing the time logic

Response shape:

```json
{
  "now": "2026-06-02T23:14:00+02:00",
  "ordinance": {
    "takeaway_allowed": false,
    "window": "22:00–09:00"
  },
  "results": [
    {
      "id": "store_123",
      "name": "LA CERVECERÍA DEL DUQUE",
      "address": "Calle del Pez 15",
      "lat": 40.4255,
      "lng": -3.7081,
      "distance_m": 240,
      "walk_min": 3,
      "place_type": "bar",
      "is_chain": false,
      "confidence_level": "high",
      "confidence_score": 92,
      "badges": ["bar", "abierto_ahora", "vende_cerveza_in_situ"],
      "open_now": {
        "open": true,
        "closes_at": "02:00",
        "sells_beer_now": true,
        "reason": "Bar abierto en horario habitual."
      },
      "sources": ["censo_madrid", "osm"]
    }
  ]
}
```

### GET `/stores/map`

Returns stores inside map bounds for cluster rendering. Same filters as
`/nearby`. Trimmed payload — no `open_now.reason`, no `address`.

Params: `north`, `south`, `east`, `west`, `zoom` plus the nearby filters.

### GET `/stores/:id`

Full detail. Includes:

- Name, address, coordinates, place_type, chain flag.
- Badges, confidence with score-explanation strings.
- All known source rows: Censo activity codes, OSM tags and opening_hours_raw.
- Open-now evaluation for `now` (and `at_time` if provided).
- Recent community feedback summary.
- `last_seen_in_official_source_at`, `last_seen_osm_at`.

### POST `/stores/:id/feedback`

Anonymous correction.

Body:

```json
{
  "feedback_type": "wrong_hours",
  "value": "Mo-Fr 09:00-22:00; Sa 10:00-14:00",
  "comment": "Closed Sundays"
}
```

Supported feedback types:

- `still_open`, `still_serves`, `closed_or_missing`, `closed_now`
- `wrong_hours` (value = corrected OSM-syntax string)
- `sells_drinks`, `sells_cold_beer`
- `opens_late`, `is_24h`
- `not_a_bar`, `not_a_shop`, `wrong_location`

## Admin endpoints

Protected by simple admin token.

- `GET /admin/import-runs` — list ingestion runs.
- `POST /admin/import-runs/manual` — trigger manual ingestion (`censo_madrid` or `osm`).
- `GET /admin/feedback` — moderation queue.
- `POST /admin/stores/:id/overrides` — create/update manual override.
- `GET /admin/chain-patterns` / `POST /admin/chain-patterns` — manage chain list.
