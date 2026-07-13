#!/usr/bin/env python3
"""Top searched areas, from the Caddy access log (roadmap §3 / docs/15, Lens 2).

GoAccess tells you *who* visits (device, country). This tells you *where they
look on the map* — the real "should I add the Málaga censo?" signal — by reading
the coordinates in your own /api/stores/* requests and binning each to the
nearest major Spanish metro.

Cookieless and first-party: it only parses request URIs you already log.

Usage (on the VPS):
    python3 scripts/top-areas.py [/path/to/access.log]

Defaults to the deploy log path. Reads plain or .gz-rotated siblings too.
"""

import glob
import gzip
import json
import math
import os
import re
import sys
from collections import Counter

DEFAULT_LOG = "/root/cervezadonde/deploy/logs/caddy/access.log"

# Major Spanish metros (lat, lng). A request is credited to the nearest one
# within MATCH_KM; anything else falls into "Otras zonas".
METROS = {
    "Madrid": (40.4168, -3.7038),
    "Barcelona": (41.3874, 2.1686),
    "Valencia": (39.4699, -0.3763),
    "Sevilla": (37.3891, -5.9845),
    "Zaragoza": (41.6488, -0.8891),
    "Málaga": (36.7213, -4.4214),
    "Murcia": (37.9922, -1.1307),
    "Palma de Mallorca": (39.5696, 2.6502),
    "Las Palmas": (28.1235, -15.4363),
    "Bilbao": (43.2630, -2.9350),
    "Alicante": (38.3452, -0.4810),
    "Córdoba": (37.8882, -4.7794),
    "Valladolid": (41.6523, -4.7245),
    "Vigo": (42.2406, -8.7207),
    "Granada": (37.1773, -3.5986),
    "A Coruña": (43.3623, -8.4115),
    "Gijón": (43.5322, -5.6611),
    "Santa Cruz de Tenerife": (28.4636, -16.2518),
    "Pamplona": (42.8125, -1.6458),
    "San Sebastián": (43.3183, -1.9812),
    "Santander": (43.4623, -3.8099),
}
MATCH_KM = 45.0


def haversine_km(a_lat, a_lng, b_lat, b_lng):
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def nearest_metro(lat, lng):
    best, best_km = None, MATCH_KM
    for name, (mlat, mlng) in METROS.items():
        d = haversine_km(lat, lng, mlat, mlng)
        if d <= best_km:
            best, best_km = name, d
    return best or "Otras zonas"


def coord_from_uri(uri):
    """Return (lat, lng) for a /api/stores/* request, or None."""
    q = dict(re.findall(r"[?&]([a-z_]+)=(-?\d+\.?\d*)", uri))
    if "/api/stores/nearby" in uri and "lat" in q and "lng" in q:
        return float(q["lat"]), float(q["lng"])
    # map + clusters carry a bbox; use its centre
    if ("/api/stores/map" in uri or "/api/stores/clusters" in uri) and all(
        k in q for k in ("north", "south", "east", "west")
    ):
        return (float(q["north"]) + float(q["south"])) / 2, (
            float(q["east"]) + float(q["west"])
        ) / 2
    return None


def open_any(path):
    return gzip.open(path, "rt", errors="ignore") if path.endswith(".gz") else open(
        path, errors="ignore"
    )


def log_paths(base):
    """The base log plus Caddy's rolled siblings (access-<ts>.log[.gz]),
    de-duplicated by real path so nothing is counted twice."""
    d = os.path.dirname(base) or "."
    stem = os.path.basename(base)
    name = stem[:-4] if stem.endswith(".log") else stem
    seen, out = set(), []
    for p in [base, *glob.glob(os.path.join(d, name + "-*.log*"))]:
        rp = os.path.realpath(p)
        if os.path.isfile(p) and rp not in seen:
            seen.add(rp)
            out.append(p)
    return out


def main():
    argv = sys.argv[1:]
    tsv = "--tsv" in argv  # machine-readable "area<TAB>hits" for the monthly archive
    html = "--html" in argv  # HTML table for the /analytics dashboard page
    positional = [a for a in argv if not a.startswith("-")]
    base = positional[0] if positional else DEFAULT_LOG
    paths = log_paths(base)
    # Count DISTINCT visitors per area (dedupe by IP), so panning the map around
    # one city counts as one interested visitor, not one per request.
    pairs = set()
    for path in paths:
        try:
            fh = open_any(path)
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    req = json.loads(line)["request"]
                    uri = req["uri"]
                except (ValueError, KeyError, TypeError):
                    continue
                coord = coord_from_uri(uri)
                if not coord:
                    continue
                ip = req.get("remote_ip") or req.get("client_ip") or req.get("remote_addr") or "?"
                pairs.add((ip, nearest_metro(*coord)))

    areas = Counter(area for _, area in pairs)
    total = sum(areas.values())
    visitors = len({ip for ip, _ in pairs})

    if html:
        if not total:
            print("<p>Sin búsquedas registradas todavía.</p>")
            return
        print(f"<p>{visitors} visitantes distintos han explorado el mapa.</p>")
        print("<table><tr><th>Zona</th><th>visitantes</th><th>%</th></tr>")
        for name, n in areas.most_common():
            print(f"<tr><td>{name}</td><td>{n}</td><td>{n / total:.0%}</td></tr>")
        print("</table>")
        return
    if tsv:
        for name, n in areas.most_common():
            print(f"{name}\t{n}")
        return
    if not total:
        print("No searches yet — check back once people use the map.")
        return
    print(f"Top areas by distinct visitors ({visitors} visitors)\n")
    print(f"{'Area':<26}{'visitors':>9}{'share':>9}")
    print("-" * 44)
    for name, n in areas.most_common():
        print(f"{name:<26}{n:>9}{n / total:>8.0%}")


if __name__ == "__main__":
    main()
