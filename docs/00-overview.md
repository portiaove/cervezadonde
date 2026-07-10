# 00 — Architecture overview

How cervezadonde.es fits together, end to end. Start here.

> One-liner: a mobile-first map that answers **"¿dónde está la cerveza abierta
> más cercana ahora?"** — distinguishing **barra** (para tomar) from **lata**
> (para llevar), honouring opening hours and Madrid's 22:00–09:00 ordinance.

## 1. The one idea: two separate worlds

The whole system splits into two flows with opposite needs. Internalise this
and everything else falls into place.

```mermaid
flowchart TB
  subgraph SERVICE["🌐 SERVICE — always on, on the VPS, read-only"]
    direction LR
    U["📱 Browser"] -->|HTTPS| C["Caddy<br/>(reverse proxy + TLS)"]
    C -->|"/*"| W["Web (static build)<br/>Vite + React + MapLibre"]
    C -->|"/api/*"| A["API<br/>Fastify + Zod"]
    A -->|SQL| DB[("PostgreSQL + PostGIS")]
  end

  subgraph PIPELINE["🏭 DATA PIPELINE — batch, on your PC, heavy"]
    direction LR
    SRC["Sources:<br/>Madrid Censo (CSV)<br/>OpenStreetMap (Overpass / Geofabrik pbf)"] --> WK["Workers<br/>(Node CLIs + osmium)"]
    WK --> LDB[("Local PostGIS")]
  end

  LDB -.->|"push-data.ps1<br/>(pg_dump → restore)"| DB
```

- **Service**: always online, only *reads*, answers fast. Lives on a small VPS.
- **Pipeline**: *builds* the data, is slow/heavy, runs on the maintainer's PC on
  demand, then **publishes** the finished tables to the VPS. The expensive work
  (downloading, filtering, matching hundreds of thousands of places) never
  touches production.

Everything is one **pnpm monorepo**.

## 2. Request flow (what happens when you open the map)

```mermaid
sequenceDiagram
  participant B as Browser (React)
  participant C as Caddy
  participant A as API (Fastify)
  participant P as PostGIS

  B->>C: GET /api/stores/map?bbox=…&open_now=…
  C->>A: proxy → /stores/map (strips /api)
  A->>P: spatial query (ST_MakeEnvelope, GIST index)
  P-->>A: rows in the viewport
  A->>A: openNow.ts — for each row, compute<br/>"can it sell/serve a beer now?"<br/>(Europe/Madrid time + 22:00 ordinance)
  A-->>B: { now, ordinance, results[] }
  B->>B: colour markers by intent (lata/barra),<br/>ring by open state; draw legend + time chip
```

Same-origin routing (`/api/*` → API, everything else → static web) means **no
CORS** and one TLS cert. The web is built with `VITE_API_URL=/api`.

## 3. Data pipeline flow (how stores get built)

```mermaid
flowchart LR
  subgraph Sources
    CENSO["Madrid Censo<br/>(official CSV)"]
    OSM["OpenStreetMap"]
  end

  OSM -->|"Overpass (region)"| RG["ingest:osm:region"]
  OSM -->|"Geofabrik .pbf<br/>+ osmium (Docker)"| PBF["ingest:osm:pbf<br/>⭐ national"]
  CENSO -->|"download + score"| MAD["ingest:madrid"]

  PBF --> CLASS["classify tags →<br/>place_type + lata/barra"]
  RG --> CLASS
  CLASS --> STORES[("stores<br/>source_name='osm'<br/>= CANONICAL")]

  MAD --> CENSOROWS[("stores<br/>source_name='censo_madrid'")]
  CENSOROWS -.->|"spatial merge:<br/>flag 'oficial' +<br/>copy official fields +<br/>hide duplicates"| STORES

  STORES -.->|push-data| PROD[("VPS PostGIS")]
```

**Model (ADR-007):** OSM is the **canonical** source of *what places exist*
nationwide (one uniform schema). The Madrid Censo is **enrichment**: where it
matches an OSM store it stamps `oficial` and merges its official address /
district / status; the duplicate Censo row is hidden (not deleted); Censo-only
places stay active. No official data is lost.

## 4. Components

### Web — `apps/web`
Vite + React 18 + **MapLibre GL JS** (open map renderer) + TypeScript.
- `App.tsx` — the map, viewport fetching, markers, geolocation, nearest-open card.
- `store-view.ts` — derives **intent** (barra/lata) and **state** (open /
  ordinance / closed / unconfirmed) → marker colour + ring.
- `Controls.tsx` — time chip, filter chips. `StoreCard.tsx` — the detail sheet.
- In production it's **static files** served by Caddy (no server).

### API — `apps/api`
Node 22 + **Fastify** + **Zod** + the `postgres` client, run under **tsx**.
- Routes: `/health`, `/stores/nearby` (lat/lng + radius), `/stores/map` (bbox).
  Filters: `open_now`, `intent`, `hide_chains`, `place_type`, `at_time`.
- **`openNow.ts`** — the product's core logic (see §6).

### Database — `packages/db` + PostgreSQL/PostGIS
- **PostGIS** does the geospatial work; a functional GIST index on
  `(geom::geography)` makes "nearby" and the OSM↔Censo match fast.
- `packages/db` holds the **migrations** (`node-pg-migrate`, `migrations/*.sql`)
  and the shared connection client.

### Shared contract — `packages/shared`
**Zod** schemas shared by web + API: the shape of a `store`, each endpoint's
query/response. One source of truth; a change is type-checked on both sides.

### Workers — `apps/worker`
Node + TypeScript CLIs (`commander`). Each is a batch job:

| Command | Role |
|---|---|
| `ingest:madrid` | Download the Madrid Censo CSV, score it, upsert (enrichment source). |
| `ingest:osm` | Add OSM `opening_hours` onto existing stores (legacy enrichment). |
| `ingest:osm:region` | Overpass → canonical stores for a region (prototype). |
| **`ingest:osm:pbf`** | **Geofabrik `.pbf` + osmium → canonical stores, national.** |
| `diagnose:madrid` | Inspect the Censo file shape, no writes. |

The national path (`ingest:osm:pbf`): download a Geofabrik extract →
**osmium** (`tags-filter` + `export`, run in a Docker image) filters bars+shops
→ stream the GeoJSON, take a point per place (centroid for ways) → classify →
`persistOsmCanonical` (bulk upsert + the Censo merge).

## 5. Data model

```mermaid
erDiagram
  STORES {
    bigint id PK
    text source_name "osm | censo_madrid | fixture"
    text source_local_id "e.g. n123"
    text name
    geometry geom "Point 4326 (GIST index)"
    place_type place_type "bar|supermercado|alimentacion|bodega|tienda_24h|otro"
    bool sells_onsite_beer "→ barra"
    bool sells_takeaway_beer "→ lata"
    text opening_hours_osm
    text confidence_level "high|medium|low|excluded"
    text[] badges "e.g. oficial"
    text official_status "from Censo"
  }
  STORE_ACTIVITIES {
    bigint store_id FK
    text epigraph_code "Censo CNAE activity"
  }
  STORE_OSM_ENRICHMENT {
    bigint store_id FK
    text opening_hours_raw
    jsonb tags
  }
  IMPORT_RUNS {
    bigint id PK
    text source_name
    text status
  }
  STORES ||--o{ STORE_ACTIVITIES : "has (Censo epigraphs)"
  STORES ||--o{ STORE_OSM_ENRICHMENT : "enriched by"
```

All sources live in the **same `stores` table**, tagged by `source_name`. The
map shows rows where `confidence_level <> 'excluded'`. The displayed row is
computed from the layers (OSM canonical + Censo merged on top), never a single
flat truth. Provenance stays separable (ODbL/attribution clarity).

## 6. The "open now" logic (product core)

`apps/api/src/openNow.ts` is pure, testable, and the only place these rules
live:

```mermaid
flowchart TD
  START["place + current time (Europe/Madrid)"] --> HRS{opening_hours known?}
  HRS -- no --> UNC["'Horario no confirmado'<br/>(blue)"]
  HRS -- yes --> OPEN{open at this time?}
  OPEN -- no --> CLO["'Cerrado' (grey)"]
  OPEN -- yes --> BAR{is it a bar?<br/>(consumes on-site)}
  BAR -- yes --> SELL["✅ can serve a beer now<br/>(green)"]
  BAR -- no --> TA{sells takeaway beer?}
  TA -- no --> NO["doesn't sell beer"]
  TA -- yes --> ORD{22:00–09:00<br/>ordinance window?}
  ORD -- yes --> AMB["⛔ open but can't sell now<br/>(amber, ordinance)"]
  ORD -- no --> SELL2["✅ can sell a beer now<br/>(green)"]
```

The 23:30 shop line — *"no puede venderte cerveza ahora (ordenanza)"* — is the
moment the product earns its keep; it's invisible on a generic map.

## 7. Infrastructure & delivery

```mermaid
flowchart TB
  subgraph VPS["Hetzner VPS (~4 €/mo) — docker-compose"]
    CA["Caddy :80/:443<br/>auto-HTTPS"] --> API2["API container (tsx)"]
    CA --> WEBDIST["/srv/web (static build)"]
    API2 --> PG[("Postgres + PostGIS")]
  end

  DNS["cervezadonde.es<br/>(DonDominio DNS)"] --> CA
  GH["GitHub Actions<br/>(push to main)"] -->|"build web + git pull + compose up"| VPS
  PC["Your PC<br/>weekly pipeline"] -->|"push-data.ps1<br/>dump serving tables"| PG
```

- **Code** deploys automatically on push to `main` (GitHub Actions over SSH).
- **Data** is published from your PC with `.\scripts\push-data.ps1` (dump the
  serving tables → restore on the VPS). See ADR-006 and `docs/13-deploy.md`.

## 8. Tech stack

| Layer | Tech |
|---|---|
| Web | Vite · React 18 · MapLibre GL JS · TypeScript |
| API | Node 22 · Fastify · Zod · postgres-js · (tsx in prod) |
| Workers | Node 22 · commander · csv-parse · osmium (Docker) |
| DB | PostgreSQL 16 · PostGIS 3.4 |
| Contract | Zod (shared types) |
| Proxy/TLS | Caddy |
| Monorepo | pnpm workspaces |
| Quality | Biome (lint/format) · Vitest (tests) · tsc |
| Infra | Docker Compose · Hetzner VPS · GitHub Actions |

## 9. Repo layout

```
apps/
  web/       Vite + React + MapLibre map UI
  api/       Fastify HTTP API + open-now evaluator
  worker/    ingestion CLIs (Censo, OSM Overpass, OSM Geofabrik/osmium)
packages/
  shared/    Zod contract (types shared by web + API)
  db/        PostGIS migrations + connection client
deploy/      production stack (Dockerfile.api, compose, Caddyfile, restore)
docker/      osmium.Dockerfile (OSM pbf toolchain)
scripts/     push-data.ps1 (publish data PC → VPS) + helpers
docs/        this overview + product/architecture/data/deploy docs
decisions/   ADRs 001–007
```

See the [ADRs](../decisions/) for the *why* behind the big choices — especially
[ADR-004](../decisions/ADR-004-madrid-alcohol-ordinance.md) (ordinance),
[ADR-005](../decisions/ADR-005-osm-opening-hours.md) (OSM hours),
[ADR-006](../decisions/ADR-006-deployment.md) (deployment) and
[ADR-007](../decisions/ADR-007-national-osm-primary.md) (OSM-canonical national).
