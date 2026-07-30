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
  `pubsub.besteffort.ndovloket.nl` on ports `7658`, `7664`, `7817`.
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

and `up -d` again. That one route covers the SPA, the API, `/docs` and the WebSocket.

**C. LAN only** — leave `WEB_PORT=8080` and open `http://<host>:8080`. Nothing else to do, but
note that the admin endpoints use HTTP Basic auth, so don't sign in over plain HTTP across an
untrusted network.

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
