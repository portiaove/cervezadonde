# 09 — Legal and Data Governance

## Legal posture

The product is defensible because it relies on open data, open map sources
and user contributions. It does not depend on scraping closed platforms.

## Madrid open data

Use the dataset according to its published licence and attribution
requirements. Display attribution in the footer / about page.

Example footer:

```
Contiene información reutilizada del Portal de Datos Abiertos del Ayuntamiento de Madrid.
Los datos se combinan con clasificación propia, datos de OpenStreetMap y aportaciones de usuarios.
```

## OpenStreetMap

OSM is a first-class source in this product (it provides opening hours).
That means we must:

- Display "© OpenStreetMap contributors" on any view that shows
  OSM-derived data (hours, OSM name, OSM address).
- Keep OSM-derived fields identifiable in storage. See `store_osm_enrichment`
  in doc 04.
- Understand ODbL share-alike obligations. The separation between Censo and
  OSM in storage lets us reason about it cleanly. See ADR-005.

## Google Maps / Google Places

Same as before. No scraping, no bulk extraction into our database.
(ADR-003.) If Google Maps is ever used as a tile renderer or for user-facing
Places lookups, comply with their terms; do not blend the data into our
canonical layer.

## Madrid alcohol-sale ordinance

The Madrid municipal ordinance forbids the sale of alcohol for takeaway
between 22:00 and 09:00. The product encodes this as a first-class rule.
See ADR-004 for legal sourcing and the implementation contract. Public
copy:

```
La Ordenanza Municipal de Madrid no permite la venta de alcohol para llevar
entre las 22:00 y las 09:00. La aplicación marca los establecimientos como
"no pueden vender ahora" durante esa franja.
```

We do not opine on the ordinance — we surface it as a reason.

## User feedback

Feedback is anonymous in v1 unless spam forces accounts. Minimise PII:

- `feedback_type`
- Optional `value` / `comment`
- Timestamp
- Anti-spam hash (e.g. `sha256(ip + user_agent + salt)`), not the raw IP

We do not store the user's geolocation against their identity. The map
client uses geolocation in the browser only.

## Moderation

User feedback never instantly rewrites canonical data:

1. Feedback is recorded with `moderation_status='pending'`.
2. After threshold (N matching reports) or admin acceptance, it affects
   confidence or adds badges.
3. All effects are reversible — the feedback row is the audit trail.

## Sensitive language

The product is functional, not ethnic. We talk about *bars*, *supermercados*,
*alimentaciones*, *bodegas*, *tiendas 24h* — never about owners' origin.
The internal field is `place_type`, never `owner_origin`.

## Minors / responsible drinking

Phase 3 about page includes a brief responsible-drinking notice and links
to Madrid's relevant health resources. The app does not encourage
consumption beyond surfacing availability.
