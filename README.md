# OVLive

Realtime public-transit map for the Netherlands. Fuses **GTFS static** timetables with
the **NDOV realtime ZMQ feeds** and serves live vehicle positions to web and mobile
clients over a public, API-key-gated API.

> Data © the Dutch transit operators via [OVapi](https://gtfs.ovapi.nl) and
> [NDOV Loket](https://data.ndovloket.nl). OVLive is an independent project and does not
> represent any transit agency. Best-effort data, no SLA.

## Monorepo

| Path | What |
|------|------|
| `crates/` | Rust backend workspace (ingestion + API + WS, single binary) |
| `packages/proto` | `ovlive.proto` — shared WebSocket contract |
| `apps/web` | React Router 7 SPA (Phase 2) |
| `apps/mobile` | Expo React Native app (Phase 3) |
| `migrations/` | Postgres migrations (sqlx) |

See **[CLAUDE.md](./CLAUDE.md)** for architecture, decisions, and the data-source rules
(the GTFS download policy is strict — read it before touching `crates/gtfs`).

## Quick start

```bash
# backend (needs Rust stable; no system protoc/libzmq required)
just build          # cargo build --workspace
just test           # cargo test --workspace
just run            # run the server locally (expects DATABASE_URL)

# full stack in Docker (postgres + server)
cp .env.example .env
just up             # docker compose up --build
```

The API is documented at `/docs` (Scalar UI) once the server is running, with an
interactive "try it with your API key" playground.

## Production

Images are built by `.github/workflows/docker.yml` and pushed to the GitHub Container
Registry; `docker-compose.prod.yml` pulls them and runs postgres, the server, nginx and a
Cloudflare Tunnel, with no port published to the host. See
**[docs/DEPLOY.md](./docs/DEPLOY.md)**.

```bash
export IMAGE_PREFIX=ghcr.io/my-org IMAGE_TAG=latest
export POSTGRES_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... CLOUDFLARE_TUNNEL_TOKEN=...
export GTFS_USER_AGENT='OVLive/0.1 (+contact: you@example.com)'   # quote it: parentheses
just prod-pull && just prod-up
```

## Configuration

Copy `.env.example` to `.env`. Key vars: `DATABASE_URL`, `DATA_DIR`, `BIND_ADDR`,
`GTFS_URL`, `GTFS_USER_AGENT` (must identify you — see policy), `GTFS_REFRESH_TZ`,
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (seeds the admin account on first boot).
