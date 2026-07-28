# Deploying OVLive

Two images, built in CI and pulled on the host. Nothing is built in production.

| Image | From | Runtime |
|---|---|---|
| `ovlive-platform-api` | `Dockerfile` | distroless — the Rust binary, migrations, `/data` volume |
| `ovlive-platform-web` | `Dockerfile.web` | nginx — the static SPA, and a proxy to the server |

The image names deliberately differ from the crate (`ovlive-server`) and the package
(`@ovlive/web`). A ghcr namespace is per *owner*, not per repo, and this owner's already holds
`ovlive-server`, `ovlive-web` and `ovlive-api` from the pre-Rust projects — `ovlive-api` and
`ovlive-web` belong to the still-live `EldinHb/ovlive`. Prefixing with the repo name keeps this
repo's images out of their way permanently.

The compose *service* names are still `server` and `web` — nginx proxies to `server:8080` by
name, so those are load-bearing and must not be renamed.

The production stack (`docker-compose.prod.yml`) is those two plus `postgres` and
`cloudflared`. **No port is published to the host**: Cloudflare Tunnel is the only ingress.

```
Internet → Cloudflare edge → cloudflared → web (nginx :80) ┬→ static SPA
                                                           └→ /v1, /health, /docs → server :8080 → postgres
```

Serving the API through nginx on the SPA's own origin is deliberate: one hostname, no CORS,
and the WebSocket is same-origin. `API_BASE` overrides it if you ever split them.

## 1. CI → registry

`.github/workflows/docker.yml` builds both images on every push to `main`, on `v*` tags, and
on pull requests (PRs build but never push — a fork's token is read-only anyway).

**There is nothing to configure.** Pushes authenticate with the automatic `GITHUB_TOKEN` under
the workflow's `packages: write` permission, and the images land at:

```
ghcr.io/<owner>/ovlive-platform-api
ghcr.io/<owner>/ovlive-platform-web
```

Set the `IMAGE_PREFIX` repository variable only to override that — a different owner, or a
different registry entirely (`ghcr.io/my-org`). Owner names are lowercased automatically;
ghcr rejects uppercase in an image path.

Tags produced: `latest` (default branch), `sha-<short>` on every build, the branch name, and
`X.Y.Z` / `X.Y` for `v*` tags. Images are `linux/amd64` only — an arm64 Rust release build
under QEMU takes hours, so add a native arm64 runner to the matrix if you need that arch.

### Pulling on the host

Packages inherit the repository's visibility. If the repo is **public**, the host pulls with
no credentials at all and you can skip this.

If it's **private**, log the Docker daemon in once with a personal access token that has
`read:packages` (a classic PAT; fine-grained tokens can't read packages yet):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

The credential persists in `~/.docker/config.json`, so `docker compose pull` just works
afterwards. For an unattended host, prefer a machine account over your own PAT.

## 2. Cloudflare Tunnel

Create a tunnel in **Zero Trust → Networks → Tunnels** and copy its token. This is a
*remotely-managed* tunnel: routing lives in the dashboard, not in this repo. Add one public
hostname:

| Field | Value |
|---|---|
| Subdomain / domain | e.g. `ovlive.nl` |
| Service | `HTTP` → `web:80` |

That single route covers the SPA, the REST API, `/docs` and the WebSocket. Enable
**WebSocket** support for the tunnel (Network → Settings) — `/v1/stream` is the whole live
map, and it fails closed without it.

Cloudflare's proxy caches nothing here by default; `/config.js` is served `no-store` and
`/assets/*` are content-hashed and immutable, so a default cache rule is safe either way.

## 3. Host

Export the secrets in the host environment (shell profile, systemd unit, or secret manager) —
`.env.prod.example` lists them. `docker-compose.prod.yml` uses the `${VAR:?message}` form for
each, so a missing one aborts `up` with a named error rather than starting half-configured.

```bash
export IMAGE_PREFIX=ghcr.io/my-org IMAGE_TAG=latest
export POSTGRES_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=...
export CLOUDFLARE_TUNNEL_TOKEN=...
# Quote it — the parentheses would otherwise be a shell syntax error.
export GTFS_USER_AGENT='OVLive/0.1 (+contact: you@example.com)'

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f server
```

Upgrading is `pull` + `up -d` again. Pin `IMAGE_TAG` to a `sha-…` tag if you want the rollback
to be a one-line change.

### What the host needs

- **~4 GB RAM for the server alone.** The parsed GTFS store is ~2 GB resident (1.04M trips,
  75k stops), plus the day-scoped stop indexes.
- **~1.5 GB disk on the `ovlive-data` volume**: the cached `gtfs-nl.zip` (~232 MiB) and the
  snapshots (`gtfs.snap` is ~325 MB).
- Outbound access to `gtfs.ovapi.nl:443` and `pubsub.besteffort.ndovloket.nl:7658,7664,7817`.

### Two things that will bite you

- **Never scale `server` past one replica.** Fair use with NDOV is one ZMQ SUB connection per
  datastream *per process*; the service holds three. Two containers means two subscriptions on
  each, which is how a project gets blocked. `deploy.replicas: 1` documents it, but nothing
  enforces it against a manual `--scale`.
- **`ovlive-data` is not a throwaway cache.** Delete it and the next boot re-downloads the
  232 MiB feed instead of restoring from snapshot — precisely what the data-source policy in
  [CLAUDE.md](../CLAUDE.md) exists to prevent. Back it up or leave it alone.

## 4. Verify

```bash
docker compose -f docker-compose.prod.yml ps
curl -s https://ovlive.example.com/health        # {"gtfs_loaded":true,"live_vehicles":3034,...}
curl -s https://ovlive.example.com/config.js     # window.__OVLIVE_CONFIG__ = { apiBase: "" };
```

First boot is slow — no snapshot exists yet, so it downloads and parses the whole feed (a few
minutes) before `/health` reports `gtfs_loaded: true`. Later boots restore in ~25 s.

`live_vehicles` in the low thousands means KV6 is flowing. Zero a minute after boot means the
ZMQ subscriptions aren't delivering — check the `subscribed stream=` lines in the server log.

The server has **no compose healthcheck** on purpose: its image is distroless, so there's no
shell, curl or wget inside to run one with. Use `/health` through the web container instead.

## Runtime configuration of the SPA

Vite inlines `import.meta.env.*` at build time, so a baked-in API URL would mean one image per
environment. Instead the web image writes `/config.js` at container start from `$API_BASE`
(`docker/web/10-ovlive-config.sh`), and `apps/web/app/lib/config.ts` reads
`window.__OVLIVE_CONFIG__` first, falling back to `VITE_API_BASE` and then to
`http://127.0.0.1:8080` for `pnpm dev`. Empty means same origin.
