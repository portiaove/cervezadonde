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
coordinates into regions; `scripts/top-areas.*` (a small log-parser, TODO) does
that. The street-search *text* goes to Photon (external) so it isn't logged; the
map moving to that area is, so you still capture the area.

### Setup (on the VPS, once the logging config above is deployed)

```bash
apt-get update && apt-get install -y goaccess
mkdir -p /root/cervezadonde/deploy/web-analytics
```

Generate a report on demand (and via a daily cron). `--anonymize-ip` for
privacy; `--log-format=CADDY` parses Caddy's JSON:

```bash
goaccess /root/cervezadonde/deploy/logs/caddy/access.log \
  --log-format=CADDY --anonymize-ip \
  -o /root/cervezadonde/deploy/web-analytics/report.html
```

Cron it daily (`crontab -e`):

```
30 4 * * * goaccess /root/cervezadonde/deploy/logs/caddy/access.log --log-format=CADDY --anonymize-ip -o /root/cervezadonde/deploy/web-analytics/report.html 2>/dev/null
```

**Retention.** Simple mode (recommended to start): the report covers whatever
Caddy still retains (`roll_size` × `roll_keep` in the Caddyfile — bump
`roll_keep` for a longer window; disk is 40 GB). For **long-term aggregates that
survive log deletion**, switch to persistent mode (`--persist --restore
--db-path=/root/goaccess-db`) — process each *rotated* file once to avoid
double-counting. Start simple; upgrade only if you want history beyond the log
window.

### View it privately (password-protected)

Serve the report behind basic auth by adding to the `Caddyfile` site block
(generate the hash with `docker exec cervezadonde-caddy caddy hash-password`):

```
handle /analytics* {
    basic_auth { juan <BCRYPT_HASH> }
    root * /srv/analytics
    file_server
}
```

and mount `./web-analytics:/srv/analytics:ro` on the caddy service. Never expose
analytics publicly.

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
