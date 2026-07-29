# ADR-008 — Precision-first serving and high-confidence censo matching

## Status

Accepted — 2026-07-29. Implemented and applied to the local serving database;
production publication remains a separate operational action.

## Context

Official censos are licence/establishment directories. They are broad, but a
row marked active does not prove that the business still trades. Field checks
found censo-only places that no longer existed, which is the most damaging
failure mode for a product that sends somebody walking.

The previous OSM↔censo merge also treated the nearest censo record within 30 m
as the same business. It required neither name nor compatible type, allowed one
censo row to confirm several OSM rows, and left unmatched censo rows public.

The audited snapshot contained:

- 37,603 active censo/fixture-only rows;
- 29,801 OSM rows labelled `verified`;
- 74,106 possible OSM↔censo pairs within 30 m;
- 18,463 OSM rows with several censo candidates;
- 17,742 censo rows with several OSM candidates;
- 5,458 type mismatches in the old nearest-neighbour relation.

Distance alone is therefore not identity evidence.

## Decision

1. Public results are precision-first and OSM-backed. A row must have
   `is_published=true`; censo-only and fixture rows are retained but hidden.
2. Censos remain valuable enrichment/evidence sources. They are not deleted.
3. An OSM↔censo match is accepted only when:
   - the pair lies within 30 m;
   - both have a non-empty, non-generic normalised name;
   - their functional types are compatible (`bar` with `bar`, or two takeaway
     shop types);
   - name evidence clears one of the versioned thresholds:
     - exact name: up to 30 m;
     - token Dice similarity ≥ 0.8: up to 20 m;
     - token Dice similarity ≥ 0.6: up to 10 m;
   - neither row has another evidence-qualified candidate.
4. The final relation is one-to-one and enforced by a unique database index.
5. Address or proximity without a useful business name never produces
   `verified`, even for coincident points.
6. Each accepted OSM row persists censo source/local ID, matcher version,
   method, distance and name similarity. The `oficial` badge is rebuilt from
   this evidence on every refinement; old proximity badges are cleared.
7. `confidence_level` remains classification confidence. `is_published` is the
   independent serving decision.
8. A censo match corroborates record identity only. It never overwrites the
   canonical OSM address, district, neighbourhood or status, and it does not
   prove that the business still trades today. The API may use a matched censo
   address/district as a live fallback when the OSM field is absent; removing
   the match removes the fallback automatically.

## Consequences

The audited local snapshot changes from 207,304 API-visible rows to 169,701,
all OSM-backed. High-confidence OSM↔censo matches fall from 29,801 to 8,568:

| Censo source | Accepted |
|---|---:|
| Madrid | 3,620 |
| Barcelona city | 4,019 |
| DIBA | 583 |
| Andalucía | 346 |

This deliberately sacrifices recall. A real business missing from OSM will no
longer appear until it gains independent evidence or is added to OSM. In
exchange, an administrative record alone can no longer become a walking
recommendation.

The API value `verified` is retained for compatibility but must be read as
“identity corroborated by two sources”, not “physically verified as currently
open”.

`unverified` remains in the HTTP enum for compatibility, but the current
serving policy emits no such rows.

## Rejected alternatives

- **Keep censo-only with a warning:** rejected because users still act on the
  marker/card and field evidence showed warnings did not fix existence.
- **Shorter distance-only radius:** rejected because dense buildings contain
  different businesses at identical or near-identical coordinates.
- **Exact address + coordinate for unnamed points:** rejected because an
  address identifies premises/buildings, not necessarily the same business.
- **Delete censo rows:** rejected; they remain useful for audits, future
  evidence and reproducible re-matching.
