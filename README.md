# OVLive

Realtime public-transit map for the Netherlands. Fuses **GTFS static** timetables with the
**NDOV realtime ZMQ feeds** and serves live positions for buses, trams, metros and NS trains
over a public API — a live map, vehicle detail, and per-quay departure boards.

> Data © the Dutch transit operators via [OVapi](https://gtfs.ovapi.nl) and
> [NDOV Loket](https://data.ndovloket.nl). OVLive is an independent project and does not
> represent any transit agency. Best-effort data, no SLA.

**Self-hosting is supported and welcome** — see **[docs/DEPLOY.md](./docs/DEPLOY.md)**.
Everything you need is in the repo; there are no API keys to obtain, for the feeds or the map
tiles. Please read the [data-source policy](#data-source-policy) first: the upstream feeds are
run by volunteers and it takes very little to get an IP blocked for everyone.

## Monorepo

| Path | What |
|------|------|
| `crates/` | Rust backend workspace (ingestion + API + WS, single binary) |
| `packages/proto` | `ovlive.proto` — shared WebSocket contract |
| `apps/web` | React Router 7 SPA |
| `apps/mobile` | Expo React Native app (not started) |
| `migrations/` | Postgres migrations (sqlx) |

See **[CLAUDE.md](./CLAUDE.md)** for architecture and the reasoning behind the non-obvious
parts — most of them are upstream-feed quirks that were measured live rather than guessed.

## Quick start

```bash
cp .env.example .env    # then set GTFS_USER_AGENT to your own contact address
just up                 # docker compose up --build — postgres + server
```

Or run the backend directly (needs Rust stable; no system protoc or libzmq required):

```bash
just build && just test
just run                # expects DATABASE_URL and GTFS_USER_AGENT
```

Then the SPA, which talks to `http://127.0.0.1:8080` by default:

```bash
pnpm install
pnpm --filter @ovlive/web run dev        # http://localhost:5173
```

The API documents itself at `/docs` (Scalar UI), with an interactive playground. Data
endpoints are public and rate-limited; an API key raises your limit but is never required.

## Deploying

Two images are built by CI and pulled on the host — nothing is compiled in production.
`docker-compose.prod.yml` runs postgres, the server and nginx, published on `${WEB_PORT:-8080}`
for whatever reverse proxy you already use, plus an optional Cloudflare Tunnel.

```bash
cp .env.prod.example .env && $EDITOR .env
just prod-pull && just prod-up
```

**[docs/DEPLOY.md](./docs/DEPLOY.md)** is the full guide: requirements (~4 GB RAM), ingress
options, upgrades, and the two mistakes that will actually hurt you.

## Data-source policy

The feeds cost nothing and are maintained by volunteers, so the rules are strict and
non-negotiable. In short:

- **`GTFS_USER_AGENT` must carry a contact address you read.** It has no default and the
  server refuses to start without one. This is how an operator reaches you before blocking you.
- **One check per day** for a new timetable, conditional (`If-None-Match`), and never
  re-downloaded just to re-parse — the archive is cached on disk.
- **One ZMQ subscription per datastream, per process.** Never scale the server past one
  replica.

The full version, including the measurements behind each rule, is in
[CLAUDE.md](./CLAUDE.md#data-source-policy-strict--read-before-touching-cratesgtfs-or-cratesrealtime).

## License

[GNU AGPL-3.0](./LICENSE). You may run, modify and redistribute this, including for your own
public deployment. If you run a **modified** version as a network service, the license requires
you to offer its users the source of your modifications.
