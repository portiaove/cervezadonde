# 01 — Product Definition

## Product one-liner

A mobile-first web map that answers, in Madrid, one specific question:
**"¿Dónde puedo conseguir una cerveza ahora mismo, cerca de mí?"**

## Problem

Finding beer in Madrid right now is a navigation problem dressed up as a
search problem. Google Maps for "cerveza" returns a generic mix of bars,
supermarkets and restaurants with no time-of-day filter and no awareness of
the local rules that govern alcohol sales. The result is friction at exactly
the moment a user wants the answer fastest.

Two real constraints make this harder than it looks:

1. **Madrid's municipal ordinance forbids takeaway alcohol from shops between
   22:00 and 09:00.** Half the natural results become useless at night and no
   generic map says so.
2. **Opening hours data is patchy.** The official census has no hours;
   OpenStreetMap has them for many bars but few alimentaciones.

## MVP user promise

> "Open the web at any hour. See the nearest places that are open right now
> and can sell you a beer — bar, supermarket, alimentación, bodega or 24h
> shop — with the takeaway rule already accounted for."

## Target users

- Residents at home wanting to grab a beer in the next 10 minutes.
- People out at night looking for a bar that still serves.
- Visitors with no local knowledge of which shops sell alcohol.
- Anyone navigating the 22:00 takeaway prohibition.

## Product principles

1. **One question, one answer.** Don't bury beer behind generic filters.
2. **Time-aware by default.** The map at 23:30 is not the map at 13:30.
3. **Honest about uncertainty.** Show "horario no confirmado" when we don't
   know; never pretend.
4. **Madrid ordinance respected.** Post-22:00 shops are clearly marked as
   "no pueden vender ahora".
5. **Distinguish intent.** Bar = consume here. Shop = take away. Same map,
   different filters.
6. **Functional categories, not ethnicity.** Same rule as before.

## Core user journeys

### Journey 1 — Late-night beer

1. User opens the web at 23:14 on a Friday.
2. Map centres on user; time chip shows "23:14 · venta para llevar cerrada".
3. Only bars and authorised 24h shops appear by default.
4. User taps the closest open bar and walks there.

### Journey 2 — Quick takeaway run

1. User opens the web at 21:30.
2. App shows shops within 5 minutes, all open, all able to sell.
3. User filters "supermercado" and picks the closest.

### Journey 3 — Improve the map

1. User taps a place marked "horario no confirmado".
2. User reports "abierto hasta las 02:00".
3. Feedback enters moderation; if confirmed, the hours update on the map.

## MVP screens

### Home / map

- Madrid map, mobile-first, full bleed.
- Time chip (top): current Europe/Madrid time + "venta cerrada" / "venta abierta".
- "Cerca de mí" button.
- Filter chips: `Para tomar`, `Para llevar`, `Abre ahora`, `24h`, `Ocultar cadenas`.
- Markers sized/coloured by category × open-now state.
- Bottom sheet on tap.

### Place card

- Name / rótulo.
- Distance + estimated walking time.
- Category badge: `Bar`, `Supermercado`, `Alimentación`, `Bodega`, `Tienda 24h`.
- Hours today and "Abierto hasta HH:MM" / "Cerrado".
- Beer-availability line: "Puede venderte cerveza ahora" / "No puede vender
  ahora (ordenanza municipal)".
- Source summary (official, OSM, community).
- Feedback buttons.

### Feedback modal

- Sigue abierto.
- Cerrado / no existe.
- Vende cerveza.
- Cierra a las (input).
- Abre hasta tarde / 24h.
- No es bar / no es tienda.

## Success criteria

- Loads a Madrid map with thousands of beer-source markers.
- At 22:30 on a Friday, the map mostly shows bars; at 13:00, it shows shops
  and bars interleaved.
- Top-3 results for any random Madrid address are real, walkable, and
  accurately classified by intent (consume here vs takeaway).
- A user can correct an opening hour in under 15 seconds.

## Out of scope for v1

- Authentication beyond anti-spam.
- Native apps.
- Cities beyond Madrid.
- Beer prices.
- Reservations.
- Brand filters ("solo Mahou").
- Sunday/holiday calendar (v1.1).
- Gas stations (v2).
- Reviews/ratings as a social network.

## Public-facing name

Deferred. Internal code/package stays `cervezadonde` for now. Public
name decided alongside the deployment in Phase 3.
