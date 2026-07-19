# 16 · Existence confidence (¿existe de verdad?)

Status: **Slices 1–2 shipped** (ranking + map rendering). Slice 3 (community feedback) pending.

## The problem

cervezadonde answers one high-stakes question — *"la cerveza abierta más
cercana, ahora"* — and then sends someone walking. If that answer is a shop
that closed months ago, the user loses trust and stops using the app. So the
flagship answer must be a place we can **stand behind: it exists, it operates,
and it sells beer.**

Our data has a structural blind spot for this. Two source families, opposite
failure modes:

- **Official censos** (Madrid, Barcelona, DIBA, Andalucía) — administrative
  licence registers. Very **complete**, but they **lag real closures by
  months/years** (a licence isn't deregistered when a business shuts). Bias:
  **false positives** — dead premises shown as active. The Madrid Censo's only
  closure signal is `id_situacion_local` (we already keep `Abierto` and drop
  Cerrado/Baja) and `fx_carga` is a single publish date, not a per-record
  freshness — so **the censo is exhausted as a signal** for a place it still
  lists as `Abierto`.
- **OpenStreetMap** — community-mapped. **Incomplete** (misses many small
  shops), but **self-cleaning**: a vanished place gets `posible_cerrado` on the
  next ingest. Bias: **false negatives** — real places missing.

Neither is "more real"; they fail differently. The strongest signal is **both
agreeing**. So: **OSM presence outweighs censo presence** for existence, and
corroboration by both is strongest.

This is **national and source-agnostic**, not a Madrid quirk: 67% of Spain's
active stores are OSM-only (no censo to corroborate), 18% censo-only, 14% both;
only ~14% have real opening hours anywhere.

## The model

Existence confidence is a **third axis**, distinct from:
- `confidence_level` — *classification* confidence (is it a beer place of type X) — and it also encodes the `excluded` state, so **do not overload it**.
- `open_now.hours_source` (`osm|website|estimated|none`) — *openness* confidence.

The `verification` field (shared `Verification`, computed in `verificationExpr`
in `apps/api/src/routes/stores.ts`, exposed on `/nearby` and `/map`):

| value | meaning | existence |
|---|---|---|
| `verified` | in OSM **and** confirmed by an official censo (`oficial` badge) | strongest — two independent sources |
| `mapped` | in OSM only (a human mapped it) | corroborated |
| `unverified` | only in an official censo, absent from OSM | single source — not independently confirmed |

## Ranking policy (Slice 1 — shipped)

The "nearest open beer" answer is **existence-floor first, then distance**
(`rankOpenByTrustThenDistance` in `apps/api/src/ranking.ts`): corroborated
places (`verified`/`mapped`) rank ahead of `unverified`, distance breaks ties.
Applied only when `open_now=true` (the "find me beer" intent); plain browsing
keeps pure distance order. An `unverified` place therefore only surfaces as an
**honest fallback** when nothing corroborated is open nearby — and the
`NearestOpenCard` labels it *"Sin confirmar"* when it does.

Why a floor, not a continuous distance↔confidence weight: a literal "confidence
always wins" would march you 1 km past real shops. The floor gives the trust
guarantee without the pathological far-walk. **Open follow-up:** the
distance/confidence trade-off is currently binary (any corroborated beats any
unverified). If in practice it sends people too far, add a distance cap beyond
which a much-closer `unverified` is offered (flagged) instead.

Risk to watch — **coverage bias**: peripheral/less-touristy areas are exactly
where OSM maps worst and the real beer *is* the censo-only shop. We **label,
never hide**, so those users still get an answer.

## Map rendering (Slice 2 — shipped)

`unverified` places render as a **hollow marker**: white centre with an
intent-coloured outline (barra amber / lata blue) — instantly distinct from
both the solid open marker and the faded "cerrado" one, because
**unverified ≠ closed**. When an unverified place is closed right now, the
closed treatment wins (night maps shouldn't highlight it). Implemented as
`['case']` branches on the `verification` feature property in the
`unclustered-point` paint (App.tsx); `StoreCard` shows an amber caution box
("Sin confirmar… puede que ya no exista"), and the MoreSheet legend explains
the hollow swatch. Verified headless (Playwright): mixed viewport rendered
16 verified / 7 mapped / 29 unverified with correct visuals; clicking an
unverified marker shows the note.

## Next slices

3. **Community feedback** ("¿sigue aquí? / cerrado") — the real cure: promotes
   `unverified`→corroborated or deactivates, and feeds corrections back to OSM.
   The durable fix; ranking + rendering are the interim UX patch that makes
   today's data honest.
