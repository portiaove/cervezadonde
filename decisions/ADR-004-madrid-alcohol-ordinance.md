# ADR-004 — Madrid alcohol-sale ordinance as a first-class product rule

## Status

Accepted — 2026-06-02.

## Context

Madrid's municipal ordinance prohibits the sale of alcohol for takeaway
between 22:00 and 09:00 in commercial establishments. On-site consumption
(bars, restaurants) is not affected by the same window.

For a product whose central question is "¿dónde compro o tomo una cerveza
ahora mismo?", this rule changes the answer dramatically at the 22:00
boundary. A naive "is open now" filter would surface supermarkets at 23:00
that legally cannot sell what the user is looking for — friction at exactly
the moment we want zero friction.

## Decision

We model the ordinance as a first-class rule in the API. The open-now
evaluator returns not just `open` but also `sells_beer_now` and a
human-readable `reason`. The rule lives in **one place**:
`apps/api/src/openNow.ts`.

Concretely:

```ts
function isAlcoholTakeawayProhibited(now: Date): boolean {
  const madrid = toEuropeMadrid(now);
  const minutes = madrid.getHours() * 60 + madrid.getMinutes();
  // 22:00 → next-day 09:00, with the window crossing midnight
  return minutes >= 22 * 60 || minutes < 9 * 60;
}

function canSellBeerNow(place: Store, now: Date): {
  ok: boolean;
  reason: string;
} {
  const openCheck = isOpenNow(place.opening_hours_osm, now);
  if (!openCheck.open) return { ok: false, reason: 'Cerrado.' };
  if (place.place_type === 'bar') {
    return { ok: true, reason: 'Bar abierto en horario habitual.' };
  }
  if (!place.sells_takeaway_beer) {
    return { ok: false, reason: 'No vende alcohol para llevar.' };
  }
  if (isAlcoholTakeawayProhibited(now)) {
    return {
      ok: false,
      reason: 'Ordenanza municipal: no puede vender alcohol para llevar de 22:00 a 09:00.',
    };
  }
  return { ok: true, reason: 'Abierto. Puede venderte cerveza para llevar.' };
}
```

The UI surfaces the `reason` verbatim in the place card and uses it to
drive marker colour (amber for "ordenanza" results that are otherwise
open).

## Rationale

- **Honesty.** Generic maps don't surface this; we do. That's the product's
  reason to exist.
- **Single source of truth.** Ordinance logic centralised in one file, one
  function, fully unit-tested. No SQL `CASE WHEN` scattered across queries.
- **Testability.** The function is pure given `(opening_hours, now)`. Vitest
  covers the 22:00 boundary, midnight crossing, edge cases (`24/7` bars,
  shops with `Mo-Su 09:00-22:00`), and the case where `opening_hours` is
  null.
- **No legal opinion.** The app does not interpret the ordinance — it
  surfaces the rule with a citation in the about page and lets users act.
- **Future-proofing.** The window is parameterised. If the ordinance
  changes or we add another city with a different rule, only the constants
  move.

## Consequences

- The API response gains an `ordinance` block at the top level and an
  `open_now.sells_beer_now` field per result.
- The web UI gains a "venta cerrada" state distinct from "cerrado", with
  distinct marker styling.
- ADR-004 must be linked from `docs/09-legal-data-governance.md` (done) and
  the public about page (Phase 3).
- If we ever ingest cities beyond Madrid, the rule needs a city-aware
  dispatch. Out of v1 scope.

## Sources

The exact ordinance reference is captured in `docs/09-legal-data-governance.md`.
The runtime cite displayed to users is intentionally short ("ordenanza
municipal Madrid") with a link in the about page.
