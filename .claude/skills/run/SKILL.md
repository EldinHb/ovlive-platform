---
name: run
description: Launch and drive OVLive locally — the ovlive-server backend (REST + protobuf WS) and the apps/web SPA. Use when asked to run, start, restart, or smoke-test the app, to check the live feed is flowing, or to confirm a change works in the running app rather than only in tests.
---

# Running OVLive

Two processes: `ovlive-server` (Rust, port 8080) and the `apps/web` SPA (Vite, port 5173).
Postgres must be reachable first — it holds accounts only, but migrations and the admin
seed run at boot and startup **fails** without it.

Read `CLAUDE.md` before changing anything in `crates/gtfs` or `crates/realtime`: the
data-source policy is strict and this skill deliberately avoids re-downloading the feed.

## 1. Postgres — resolve the port, don't assume it

`.env` claims `5432`. The container publishes **5434** on this machine. Hitting the wrong
port yields a misleading `password authentication failed`, not a connection error.

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep ovlive-pg   # up?
docker port ovlive-pg 5432                                     # -> 0.0.0.0:5434
docker compose up -d postgres                                  # if it isn't running
```

Use whatever `docker port` reports; the rest of this skill writes `5434`.

## 2. Backend

The binary does **not** read `.env` (no dotenvy), and `GTFS_USER_AGENT` contains
parentheses, so `source .env` breaks the shell. Pass env explicitly:

```bash
cargo build -p ovlive-server
DATABASE_URL=postgres://ovlive:ovlive@localhost:5434/ovlive \
BIND_ADDR=0.0.0.0:8080 DATA_DIR=./data RUST_LOG=info,ovlive=debug \
GTFS_USER_AGENT='OVLive/0.1 (+contact: change-me@example.com)' \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin \
./target/debug/ovlive-server > /tmp/ovlive-server.log 2>&1 &
```

Boot takes **~24 s** with `data/*.snap` present — most of it restoring the 325 MB GTFS
snapshot, then ~2 s building stop indexes. Wait for the log, don't poll the port:

```bash
until grep -qE 'listening on|ERROR|panic' /tmp/ovlive-server.log; do sleep 1; done
tail -15 /tmp/ovlive-server.log
```

A healthy boot logs, in order: `GTFS feed loaded (routes=3195 trips=~1.04M …)` →
`restored GTFS from parsed snapshot (no download)` → `stop indexes built for <today>` →
`subscribed stream=KV78Turbo` / `stream=KV6` → `listening on http://0.0.0.0:8080`.

`restored N live trips (N pruned as stale)` is normal — snapshots older than
`STALE_TRIP_SECS` are discarded and refill from the feed within a minute.

If it instead logs a GTFS **download**, stop and investigate: boot order is
snapshot → cached `data/gtfs-nl.zip` → download, so a download means both caches were lost.

## 3. Frontend

```bash
pnpm install                                    # only if node_modules is stale
pnpm --filter @ovlive/web run dev > /tmp/ovlive-web.log 2>&1 &
```

**Read the actual port out of the log** — Vite silently falls back to 5174, 5175… when
5173 is taken (a stray `react-router dev` from an earlier session is the usual cause,
`lsof -nP -iTCP:5173 -sTCP:LISTEN`):

```bash
grep -oE 'http://localhost:[0-9]+' /tmp/ovlive-web.log | head -1
```

The SPA reaches the backend directly at `VITE_API_BASE`, default `http://127.0.0.1:8080`
(`apps/web/app/lib/config.ts`) — no dev proxy; CORS is permissive and the WS is
cross-origin. A backend elsewhere just needs
`VITE_API_BASE=http://host:port pnpm --filter @ovlive/web run dev`.

## 4. Drive it

Health is **`/health`**, not `/healthz` (`/healthz` 404s):

```bash
curl -s http://127.0.0.1:8080/health
# {"gtfs_loaded":true,"live_vehicles":3034,"status":"ok"}
```

`live_vehicles` in the low thousands means the KV6 feed is flowing. Zero, a minute after
boot, means the ZMQ subscription is not delivering.

REST — a bbox query around Amsterdam, and the docs (Scalar at `/docs`, spec at
`/openapi.json`):

```bash
curl -s 'http://127.0.0.1:8080/v1/vehicles?bbox=4.75,52.30,5.05,52.45' | head -c 400
```

Enrichment works when vehicles carry `line_public_number`, `operator_name`, `destination`
and `line_color` — ~99% do. All-`null` line fields point at a broken GTFS join
(`trips.txt.realtime_trip_id` = `"<dataowner>:<lineplanningnumber>:<journeynumber>"`).

**WS (`/v1/stream`) is protobuf and needs a `Subscribe` frame** — `curl` cannot exercise
it. Use `scripts/ws-smoke.mjs` (in this skill's directory), which speaks the same
protocol as `apps/web` via the repo's own protobufjs:

```bash
node .claude/skills/run/scripts/ws-smoke.mjs
# sent Subscribe for Amsterdam bbox
# frame 1: update entered=347 moved=0 left=0 snapshot=true
# frame 2: update entered=0 moved=7 left=0 snapshot=false
```

Frame 1 must be `snapshot=true` with a few hundred `entered`; later frames should be
mostly `moved` at roughly `WS_TICK_HZ` (default 3/s). Note the wire field names are
`entered` / `moved` / `left` — **not** `enter`/`move`/`leave`. Loading the `.proto` without
`keepCase: true` (as that script does) yields camelCase keys; `packages/api-types` uses
`keepCase: true` and therefore sees snake_case. Don't mix the two conventions up.

To exercise a different viewport or filters, edit the `subscribe` payload in that script.

## 5. Browser check

No browser driver is installed (`chromium-cli`, `playwright` both absent) and installing
one downloads browsers — **ask the user first**. Without it you can still confirm Vite
compiles the real module graph rather than just serving the shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/            # 200
curl -s http://localhost:5173/app/root.tsx | grep -ciE 'Transform failed|Failed to resolve'   # 0
```

Say plainly that the map was not visually verified when it wasn't. `app/entry.client.tsx`
does not exist (SSR is off) — a 404 there is expected, not a failure.

## 6. Shut down

```bash
pkill -f 'target/debug/ovlive-server'
pkill -f 'react-router dev'
```

**Fair use — this matters.** Exactly one ZMQ SUB connection per NDOV datastream per
process. The server holds both (KV6 `:7658`, KV78 `:7817`), so **stop the server before
running any sampler in `crates/realtime/examples/`** (`kv78listen`, `nextlinelive`) and
never run two servers at once.

To validate a GTFS parser change, use the cached zip — never re-fetch:

```bash
cargo run --release --example validate_feed -p ovlive-gtfs   # ~8 s, no network
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `password authentication failed` | Wrong Postgres port — use `docker port ovlive-pg 5432`, not `.env`'s 5432 |
| Boot hangs past ~30 s, or logs a GTFS download | `data/gtfs.snap` gone; it falls back to parsing the cached zip (slow but correct) |
| Boot re-parses after a code change | Bincode has no schema evolution — adding a field to `GtfsStore`/`LiveTrip` invalidates that snapshot. Self-healing, costs one full parse |
| `live_vehicles: 0` | ZMQ not delivering; check `subscribed stream=` lines and the idle watchdog (`ZMQ_IDLE_TIMEOUT_SECS`) |
| SPA loads, map empty | Backend down or `VITE_API_BASE` wrong — check the browser's WS to `:8080/v1/stream` |
| Vite on an unexpected port | 5173 taken by a stray dev server; read the port from the log |
| `just run` fails | It uses `set dotenv-load`, so it inherits `.env`'s wrong DB port. Prefer the explicit invocation above |
