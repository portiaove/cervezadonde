# 08 — UX, Map and Legend

## UX goal

The app answers one question, fast:

> "¿Dónde tomo o compro una cerveza ahora mismo?"

The answer must respect the time of day and the Madrid alcohol ordinance.

## Map behaviour

- Default centre: Madrid. Re-centres on "Cerca de mí".
- Markers update on map move (debounced).
- Mobile-first bottom sheet on tap.
- Time chip top-left always visible — current Europe/Madrid time plus
  global state (`venta para llevar abierta` until 22:00, `venta cerrada`
  after).

## Filter chips

Default first-line filters:

- `Cerca de mí`
- `Abre ahora`
- `Para tomar` (bars / cafeterías)
- `Para llevar` (shops)
- `24h`
- `Ocultar cadenas` (off by default)

Secondary (collapse under "más filtros"):

- `Alta confianza`
- `Verificados`
- `Bodega`

## Marker legend

### Implemented visual language (v3)

Markers are circles; two axes plus an existence overlay:

**Fill = intent** (what you can do there):

- `barra` (para tomar) — burnt amber `#c2410c`
- `lata` (para llevar) — blue `#1d4ed8`

**Ring = open-now state** (from `open_now` + `hours_source`):

- **Puede venderte ahora (horario confirmado)** — green ring, radius 8
- **Suele estar abierto (estimado)** — light-green ring, radius 8
- **Abierto pero no puede vender (ordenanza)** — amber ring
- **Horario no confirmado** — grey ring
- **Cerrado ahora** — faded (low opacity), white ring

**Existence overlay** (`verification`, see
[docs/16](./16-existence-confidence.md)): `unverified` places (censo-only,
absent from OSM) render as a **hollow marker** — white centre with an
intent-coloured outline — visually distinct from both solid-open and
faded-closed, because *sin confirmar ≠ cerrado*. If an unverified place is
closed right now, the closed treatment wins. The place card shows an amber
caution box, and the MoreSheet legend explains the hollow swatch.

## Place card copy

Examples:

```
LA CERVECERÍA DEL DUQUE
Calle del Pez 15 · 240 m · 3 min
Bar · Abierto hasta 02:00
Puede servirte cerveza ahora.

Datos de OpenStreetMap. Horario verificado.
[Sigue abierto] [Reportar error]
```

```
ALIMENTACIÓN LA ESTRELLA
Calle Argumosa 9 · 410 m · 5 min
Alimentación · Cerrado
Próxima apertura: mañana 09:00.
No puede venderte cerveza ahora (ordenanza municipal Madrid).

Datos abiertos del Ayuntamiento de Madrid.
Horario no confirmado.
[Ya está abierto] [Reportar horario] [Reportar error]
```

```
DÍA - CALLE GOYA
Calle Goya 31 · 180 m · 2 min
Supermercado · Abierto hasta 21:30
Cierra pronto. Puede venderte cerveza hasta el cierre.

Datos abiertos del Ayuntamiento de Madrid + OpenStreetMap.
[Sigue abierto] [Reportar error]
```

## Data quality labels

- "Datos oficiales" — Madrid Censo
- "Horario verificado" — OSM `opening_hours` present
- "Verificado por usuarios" — community confirmation
- "Horario no confirmado" — no hours data
- "Puede estar cerrado" — last_seen stale or community flag

## Time-of-day messaging

The time chip and the place card share the same vocabulary:

| Hora | Time chip global | Place card (shop) | Place card (bar) |
|---|---|---|---|
| 13:00 | `13:00 · venta abierta` | "Puede venderte cerveza ahora." | "Puede servirte cerveza ahora." |
| 21:45 | `21:45 · venta abierta` | "Puede venderte cerveza hasta las 22:00." | "Puede servirte cerveza ahora." |
| 23:30 | `23:30 · venta cerrada` | "No puede venderte cerveza ahora (ordenanza municipal)." | "Puede servirte cerveza ahora." |
| 04:00 | `04:00 · venta cerrada` | "No puede venderte cerveza ahora." | If `24h`: "Puede servirte cerveza ahora." else: "Cerrado." |

The shop message at 23:30 is the moment the product earns its keep — that
exact line is invisible in any generic map.

## Product tone

Useful, neighbourhood-y, slightly playful but legally and ethnically
neutral. The product talks about *places* and *hours*, not about owners.

Working internal names (not committed):

- "Cerveza Cerca"
- "Caña"
- "BeerNow Madrid"

The public name is a Phase 3 decision.
