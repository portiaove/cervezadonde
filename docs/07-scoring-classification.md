# 07 — Scoring and Classification

## Goal

For each candidate local, derive:

1. **`place_type`** — which functional category the place belongs to.
2. **`sells_takeaway_beer` / `sells_onsite_beer`** — booleans driving the
   "Para llevar / Para tomar" filters.
3. **`confidence_score`** (0–100) and **`confidence_level`**.
4. **`badges`**.

The score is not a legal or commercial truth. It is a product heuristic
that asks: *given what we know, how confident are we this place can serve
or sell beer right now?*

## Deterministic model (v2-beer)

Start deterministic. No ML in v1. Scoring version string lives in
`apps/worker/src/scoring/v2.ts` as `SCORING_VERSION = 'v2-beer'`.

### Inputs

```ts
type ScoreInput = {
  name: string;
  epigraphCodes: string[];
  officialStatus: string | null;
  openingHoursOsm: string | null;
  osmTags: Record<string, string> | null;   // shop=*, amenity=*, ...
  chainPatterns: readonly string[];         // informational only
};
```

### Algorithm

```
1. normalize name → uppercase, strip diacritics
2. is_chain = chain_patterns matches normalized name (informational flag)
3. if officially closed (Baja, Cerrado, Uso vivienda) → excluded, score=0
4. derive place_type from epigraph + OSM tags + rotulo (see table in doc 04)
5. compute base_score from place_type:
     bar           → 90
     supermercado  → 85
     bodega        → 85
     tienda_24h    → 95
     alimentacion  → 75
     otro          → 35
6. opening_hours bonus:
     +15 if opening_hours_osm parses cleanly
     +10 if opening_hours_osm == '24/7'
      0 if absent (we'll display 'horario no confirmado')
7. name hints (signal for sells_*_beer):
     +5  if name contains BAR, TABERNA, CERVEZA, CERVECERIA, PUB, IRLANDES
     +5  if name contains 24H, 24 HORAS
     +5  if name contains BODEGA, VINOS
     +5  if name contains ALIMENTACION, MINI MARKET, ULTRAMARINOS
8. OSM enrichment:
     +5  if shop=convenience or shop=alcohol
     +5  if amenity=bar|pub
9. exclusions:
     -100 if officially closed
     -100 if place_type=otro AND no name/OSM signal
10. clamp 0–100
```

### sells_takeaway_beer

True when:

- place_type ∈ {`supermercado`, `alimentacion`, `bodega`, `tienda_24h`}, **OR**
- name contains BODEGA / VINOS / CERVEZA / ALIMENTACION, **OR**
- OSM `shop` ∈ {`alcohol`, `convenience`, `supermarket`, `general`, `kiosk`}.

### sells_onsite_beer

True when:

- place_type == `bar`, **OR**
- OSM `amenity` ∈ {`bar`, `pub`, `cafe`, `restaurant`, `fast_food`} **and**
  name/tags don't obviously contradict ("CONFITERÍA", "HELADERÍA", etc.).

A place can have both true — a bodega with an in-house tasting bar, a
cafetería that sells take-away six-packs.

## Confidence levels

| Level | Score range | Notes |
|---|---|---|
| `high` | ≥ 80 | Likely useful, hours known. |
| `medium` | 55–79 | Plausible, missing hours OR weak community. |
| `low` | 30–54 | Surfaced only when user enables "mostrar posibles". |
| `excluded` | < 30 or hard exclusion | Hidden from default queries. |

## Chain handling

Chains are surfaced. The `is_chain` flag is informational and never
auto-excludes. The UI exposes a "Ocultar cadenas" toggle that is **off by
default** — covering chains is part of the v1 value (a Mercadona at 21:45
with cold cans is a perfectly valid answer).

The `chain_patterns` table seeded from doc-07-v1 is reused as-is; only its
*semantic role* changes.

## Open-now (API-side, not in this scorer)

The scorer does not encode "open now". That's computed at query time from
`opening_hours_osm` + current Europe/Madrid time + the alcohol ordinance
(ADR-004). Putting it here would freeze a moment in time on a daily-batched
score column, which is wrong.

The scorer outputs `confidence_score` (stable across the day) and the API
combines it with the live time check before returning results.

## Explainability

Each store detail should be able to surface why the score is what it is:

- "Bar registrado en el Censo de Madrid."
- "Horario detectado en OpenStreetMap."
- "Rótulo contiene 'Cervecería'."
- "Verificado por usuarios."
- "Horario no confirmado."
- "Ordenanza municipal: no puede vender alcohol ahora."

## Scoring versioning

Store `scoring_version` on each row. When rules change, bump the version
constant and re-run the worker to re-score in place (cache hit, no
download). See `docs/11-runbook.md`.
