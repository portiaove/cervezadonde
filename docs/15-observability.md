# 15 — Observability & Ops (§3)

Everything here is **free** and sized for a single-maintainer, low-traffic app
with **regenerable data**. No paid backups, no cookies, no heavy agents.

Status: **log rotation + Caddy access logging = done in code** (deploy on next
push). Uptime, GoAccess, and the recovery runbook are set up by hand per below.

---

## 1. Container log rotation — DONE (code)

Docker's default `json-file` driver grows unbounded and can fill the VPS disk
(the most likely operational failure). `deploy/docker-compose.prod.yml` now caps
every service via a shared anchor:

```yaml
x-logging: &default-logging
  driver: json-file
  options: { max-size: "10m", max-file: "3" }   # ~30 MB/service max
```

Takes effect on the next deploy (`docker compose ... up -d`). Verify on the VPS:

```bash
docker inspect -f '{{ .HostConfig.LogConfig }}' cervezadonde-api
```

## 2. Caddy access logging — DONE (code)

`deploy/Caddyfile` writes a **JSON access log**, self-rotated, bind-mounted to
`deploy/logs/caddy/access.log` on the host (git-ignored). This is the data
source for GoAccess (§4). Raw logs stay short-lived (privacy); GoAccess holds
the long-term picture.

---

## 3. Uptime monitoring — UptimeRobot (free)

External probe so you hear about outages even when the whole box is down.

1. Create a free account at uptimerobot.com.
2. Add **two HTTP(s) monitors**, 5-min interval:
   - `https://cervezadonde.es/` — the web (would have caught the web-dist 404).
   - `https://cervezadonde.es/api/health` — the API (returns `{"ok":true}`).
3. Add an alert contact (email, or Telegram for a free push).

Optional heartbeat for the **weekly refresh** (catches "PC was off for weeks, data
went stale"): create a free healthchecks.io check and add one line to the end of
`scripts/refresh-all.ps1`:

```powershell
try { Invoke-RestMethod "https://hc-ping.com/<your-uuid>" -TimeoutSec 10 } catch {}
```

If a scheduled run never pings, healthchecks emails you.

---

## 4. Analytics — GoAccess (free, cookieless, self-hosted)

Zero JS, zero cookies, zero third parties, adblock-proof — it just reads the
Caddy access log. Gives referrers, device/OS/browser, top paths, visitor counts
(approx. by IP+UA), HTTP status codes (bonus error signal), and traffic timing.

### The real product signal: *where are users looking?*

IP geolocation is weak (ISP/carrier hubs). The strong signal is the
**coordinates in your own API requests** — `/api/stores/nearby?lat=..&lng=..`,
`/api/stores/map`, `/api/stores/clusters`. A cluster of requests over Málaga is
your cue to add the Málaga censo. GoAccess lists top URLs but doesn't bin
coordinates into regions; **`scripts/top-areas.py`** does — it reads the same
Caddy log and prints a "top areas" table by nearest Spanish metro, counting
**distinct visitors** (dedupe by IP), so panning the map counts once:

```bash
python3 scripts/top-areas.py    # defaults to the deploy access.log (+ rolled siblings)
```

The street-search *text* goes to Photon (external) so it isn't logged; the map
moving to that area is, so you still capture the area.

### One command: `scripts/analytics.sh`

Install GoAccess once, then the whole picture is a single command — no juggling
flags, paths, or the GeoIP download:

```bash
apt-get install -y goaccess          # once
bash scripts/analytics.sh            # anytime, on the VPS
```

`analytics.sh` consolidates everything: it (1) fetches the free GeoIP DB if
missing, (2) regenerates the GoAccess HTML report — **crawlers ignored** so it
reflects humans, not the scanner noise, and IPs anonymised — and (3) prints the
**top searched areas** table (the censo signal) right in the terminal. One run =
the product signal immediately + a refreshed full report.

Keep it fresh automatically with a daily cron (`crontab -e`):

```
30 4 * * * cd /root/cervezadonde && bash scripts/analytics.sh >/dev/null 2>&1
```

**Retention & monthly history.** The live `report.html` is *regenerated* each
run from the logs Caddy still holds (now ~60 days: `roll_keep 30` /
`roll_keep_for 1440h`). So it's a rolling window — old data ages out. To **keep
monthly metrics**, run archive mode from a monthly cron:

```
0 5 1 * * cd /root/cervezadonde && bash scripts/analytics.sh --archive
```

`--archive` freezes a dated `web-analytics/archive/report-YYYY-MM.html` and
appends that month's top areas to `web-analytics/archive/areas-history.tsv`
(`month  area  visitors` — distinct visitors, not raw requests). Snapshots are
never overwritten, so you get a browsable month-by-month history without keeping
raw logs forever.

### The `/analytics` dashboard (private URL)

`analytics.sh` builds `web-analytics/index.html` — **one page with everything**:
the searched-areas table, a link to the full GoAccess report, and the monthly
archive. The Caddyfile + compose already mount `web-analytics` at `/srv/analytics`
and `import` any host-only routes from `/etc/caddy/conf.d/*.caddy`.

To turn on the password-protected URL, drop **one file on the VPS** — kept out of
git so the password never touches the public repo, and a missing file is a no-op
that can't break the site:

```bash
# 1. generate a bcrypt hash for your password
docker exec cervezadonde-caddy caddy hash-password --plaintext 'YOUR_PASSWORD'

# 2. create deploy/caddy-conf.d/analytics.caddy with (paste the $2a$… hash):
handle_path /analytics* {
    basic_auth {
        juan <PASTE_THE_HASH>
    }
    root * /srv/analytics
    file_server browse
}

# 3. reload Caddy
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod restart caddy
```

Then browse `https://cervezadonde.es/analytics` (user `juan` + your password). No
scp needed. Quick alternative without a URL:
`scp root@cervezadonde.es:/root/cervezadonde/deploy/web-analytics/report.html .`

---

## 5. Disaster recovery (the free alternative to paid backups)

Data is **regenerable from the PC pipeline**, so the VPS DB isn't precious yet.
Paid snapshots would insure something you already have duplicated. Instead:

- Keep the last 2–3 `serving.dump` files on your PC.
- Total-loss rebuild (~30 min) from scratch:
  1. Provision a new VPS + point DNS (docs/13 §0).
  2. `git clone`, set `deploy/.env.prod`, `docker compose ... up -d --build`.
  3. `migrate up`, then `.\scripts\refresh-all.ps1` from your PC to repopulate.

This changes the day **user feedback lands** (roadmap §5.3) — that's the first
non-regenerable data. Then add a nightly `pg_dump` of *just the feedback table*
pulled to your PC (still free). Not before.

---

## Deliberately NOT doing

- **Paid Hetzner backups** — data is regenerable (see §5).
- **Cookies / JS fingerprinting** — cookieless by design; no sessions/bounce.
- **Real-time GoAccess daemon** — overkill at this traffic; daily report is enough.
- **Sentry** — optional later; server logs + status codes cover the backend for now.
