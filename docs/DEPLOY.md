# Deploying OVLive

Four containers, pulled from a registry. Nothing is compiled on the host.

```
                          ┌─ web (nginx :80) ─┬→ static SPA
your ingress ─────────────┤                   └→ /v1, /health, /docs → server :8080 → postgres
(proxy or tunnel)         │                                                 │
                          └─ published on ${WEB_PORT}                  NDOV feeds ← ZMQ
```

`web` is the only entry point: it serves the SPA and reverse-proxies the API onto the same
origin, so there is one hostname, no CORS, and a same-origin WebSocket.

## Requirements

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`).
- **~4 GB RAM for `server` alone.** The parsed timetable is ~2 GB resident (1.04M trips,
  75k stops). Budget 5 GB for the stack.
- **~1.5 GB disk** on the `ovlive-data` volume: the cached feed (~232 MiB) plus snapshots.
- **Outbound** access to `gtfs.ovapi.nl:443` and
  `pubsub.besteffort.ndovloket.nl` on ports `7658` and `7664`.
- No inbound port is needed if you use the Cloudflare Tunnel option below.

## 1. Get the images

Fork the repo and push once to `main`. `.github/workflows/docker.yml` builds both images and
publishes them to **your own** namespace — there is nothing to configure, it authenticates with
the automatic `GITHUB_TOKEN`:

```
ghcr.io/<your-username>/ovlive-platform-api
ghcr.io/<your-username>/ovlive-platform-web
```

Packages inherit the repo's visibility. If your fork is **public**, the host pulls with no
credentials. If it's **private**, log the host's Docker daemon in once with a classic PAT that
has `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <your-username> --password-stdin
```

Prefer building on the host instead? `just docker-build` produces
`local/ovlive-platform-{api,web}:local`. Then set `IMAGE_PREFIX=local` and `IMAGE_TAG=local` in
`.env` and **skip the `pull` step** — there is no registry to pull from. The Rust release build
takes 10–20 minutes and wants ~8 GB RAM, which is why CI is the recommended path.

## 2. Configure

```bash
git clone https://github.com/<your-username>/ovlive-platform.git && cd ovlive-platform
cp .env.prod.example .env
$EDITOR .env
```

Five values are mandatory; `up` aborts with a named error if any is missing.

| Variable | Notes |
|---|---|
| `IMAGE_PREFIX` | `ghcr.io/<your-username>`. Lowercase — ghcr rejects uppercase. |
| `GTFS_USER_AGENT` | **Must be your own contact address.** See the warning below. |
| `POSTGRES_PASSWORD` | Any strong value; only ever used inside the compose network. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeds the admin account on the **first boot only**. |

> **`GTFS_USER_AGENT` is not boilerplate.** The timetable and realtime feeds are free,
> best-effort and community-run by [OVapi](https://gtfs.ovapi.nl) and
> [NDOV Loket](https://data.ndovloket.nl). This header is the only way an operator can contact
> whoever is pulling ~232 MiB a day. Put an address *you read* in it — the format is
> `OVLive/0.1 (+contact: you@example.com)`. There is no default and the server refuses to
> start without one.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f server
```

**The first boot takes several minutes** — no snapshot exists yet, so it downloads and parses
the whole feed before serving anything. Later boots restore in ~25 s.

## 4. Choose your ingress

`web` is published on `${WEB_PORT:-8080}` and speaks **plain HTTP**. Terminating TLS is on you.

**A. Your own reverse proxy** (Caddy, Traefik, nginx, Nginx Proxy Manager) — the default.
Point it at `http://<host>:8080` and make sure it forwards WebSocket upgrades; `/v1/stream` is
the entire live map. A minimal Caddyfile:

```
ovlive.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Set `WEB_PORT=127.0.0.1:8080` when the proxy runs on the same host, so the port isn't exposed
to your LAN as well.

**B. Cloudflare Tunnel** — no inbound port, no TLS setup of your own. In **Zero Trust →
Networks → Tunnels**, create a tunnel, copy its token, and add one public hostname routed to
`HTTP` → `web:80`. Enable **WebSocket** support under Network → Settings. Then in `.env`:

```
COMPOSE_PROFILES=cloudflare
CLOUDFLARE_TUNNEL_TOKEN=<the token>
WEB_PORT=127.0.0.1:8080
```

and `up -d` again. That one route covers the SPA, the API, `/docs` and the WebSocket. The
tunnel needs no inbound firewall rule and no port forwarding — `cloudflared` dials out.

Cloudflare's proxy caches nothing here by default; `/config.js` and the SPA shell are served
`no-store` and `/assets/*` are content-hashed and immutable, so a default cache rule is safe
either way. Don't add a **Cache Everything** rule: it would cache the shell, which names the
hashed bundles, and pin visitors to an old deploy until the edge cache expires.

**C. LAN only** — leave `WEB_PORT=8080` and open `http://<host>:8080`. Nothing else to do, but
note that the admin endpoints use HTTP Basic auth, so don't sign in over plain HTTP across an
untrusted network.

### What stays private

Whichever ingress you pick, the web container returns **404** for `/v1/register`, `/v1/keys*`
and `/v1/admin/*` ([nginx.conf.template](../docker/web/nginx.conf.template)). Those are the whole
write surface — open signup, key minting, disabling users — guarded only by HTTP Basic, which is
not something to leave facing the internet on a home server.

Compose therefore publishes the API itself on `127.0.0.1:${ADMIN_PORT:-8081}`, so you can still
reach them from the host or through an SSH tunnel:

```bash
curl -s -u "$ADMIN_EMAIL:$ADMIN_PASSWORD" http://127.0.0.1:8081/v1/admin/users
ssh -L 8081:127.0.0.1:8081 homeserver    # then hit http://127.0.0.1:8081 from your laptop
```

`ADMIN_PORT` must differ from `WEB_PORT` — two services cannot bind the same host port, and
binding loopback rather than the wildcard address makes no difference to that.

`/docs` and `/openapi.json` stay public and still *document* those endpoints; the spec is the
API's description, not its access control. Drop the `ports:` block from the `server` service to
close the loopback path too, and add a Cloudflare Access policy if you ever want them published
with a real identity check in front.

## 5. Verify

```bash
curl -s localhost:8080/health          # or your public hostname
```

```json
{ "gtfs_loaded": true, "live_vehicles": 3034, ... }
```

`live_vehicles` in the low thousands means the realtime feeds are flowing. Zero a minute after
boot means the ZMQ subscriptions aren't delivering — look for `subscribed stream=` lines in
`logs server`.

## Upgrading and rolling back

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Pin `IMAGE_TAG` to a `sha-<short>` tag if you want rollback to be a one-line change. Every
build is tagged `latest` (default branch), `sha-<short>`, the branch name, and `X.Y.Z` for
`v*` tags. Images are **linux/amd64 only** — an arm64 Rust release build under QEMU takes
hours, so add a native arm64 runner to the CI matrix if you need it.

## Two things that will bite you

- **Never run more than one `server` replica.** Fair use with NDOV is one ZMQ subscription per
  datastream *per process*, and this service holds three. Two containers means two
  subscriptions on each, which is how a project gets blocked upstream. `deploy.replicas: 1`
  documents it, but nothing stops a manual `--scale`.
- **`ovlive-data` is not a throwaway cache.** It holds the cached feed and the snapshots the
  server boots from. Delete it and the next start re-downloads 232 MiB instead of restoring —
  exactly what the data-source policy exists to prevent. Back it up or leave it alone.

## Backups

Postgres holds **only** accounts and API keys — never vehicle data — so a nightly logical dump is
the whole story, and it is small:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U ovlive -d ovlive --no-owner | gzip > "ovlive-$(date +%F).sql.gz"
```

`ovlive-data` needs no scheduled backup: everything in it is reconstructible from upstream. Losing
it just costs one feed download and a slow first boot, which is worth avoiding but is not data
loss. Copy it if you want fast recovery.

## Rate limits

Three tiers, all applied to a single request, outermost first
([auth.rs](../crates/api/src/auth.rs)):

| Tier | Knob | Default | Applies to |
|---|---|---|---|
| Per client IP | `PUBLIC_RATE_PER_MIN` | 6000/min | every request |
| Per account | `USER_RATE_PER_MIN` | 1200/min | requests with a valid key, summed over that account's keys |
| Per key | the key's own `rate_per_min` | 120/min | requests with that key |

The per-IP tier is high by design. The web app is anonymous, so this is the budget *one* visitor
gets, and ordinary use (a viewport fetch per pan, the stop layer, a departure board every 12 s, a
vehicle detail every 8 s) is orders of magnitude below it. It replaced a single process-wide bucket
that all anonymous traffic shared, where one scraper meant 429s for every visitor.

Because every request arrives from nginx, the client is recovered from `CF-Connecting-IP`, else the
leftmost `X-Forwarded-For` hop. Those headers are only believed when the socket peer is
loopback/private — a proxy on our own network — so a request that reaches the port directly is
always charged to its real address. Nothing else in the app trusts them.

For abuse that spans many IPs, add a Cloudflare WAF rate-limiting rule at the edge; that is the
right layer for it, and it never reaches the tunnel.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `required variable ... is missing a value` | A mandatory var isn't in `.env`. Run `just prod-config` to check before starting. |
| `GTFS_USER_AGENT is required` in the server log | Set in `.env` but not reaching the container — confirm `.env` sits next to the compose file. |
| Map loads, no vehicles, `/health` fine | WebSocket isn't being proxied. Check upgrade headers, or enable WebSocket on the tunnel. |
| `gtfs_loaded: false` for many minutes | Normal on first boot. After that, check outbound access to `gtfs.ovapi.nl:443`. |
| Server restart-loops on a fresh host | Almost always RAM. The GTFS parse needs ~4 GB; the OOM killer leaves no message in the container log. |
| `docker compose` says `cloudflared` is unknown | The profile isn't active. `COMPOSE_PROFILES=cloudflare` must be exported or in `.env`. |

`server` has no compose healthcheck on purpose: its image is distroless, so there's no shell,
curl or wget inside to run one with. Check `/health` through `web` instead.

## Note on the SPA's API URL

Vite inlines env vars at build time, so a baked-in API URL would mean one image per
deployment. Instead the web container writes `/config.js` at start from `$API_BASE`
(`docker/web/10-ovlive-config.sh`) and the SPA reads it at runtime. Empty — the default —
means same origin, which is what you want unless you publish the API on its own hostname.
