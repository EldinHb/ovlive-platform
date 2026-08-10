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
parentheses, so `source .env` breaks the shell. Extract that one value and pass env explicitly:

```bash
cargo build -p ovlive-server
export GTFS_USER_AGENT="$(sed -n 's/^GTFS_USER_AGENT=//p' /Users/eldin/Projects/Ovlive/.env | head -1)"
DATABASE_URL=postgres://ovlive:ovlive@localhost:5434/ovlive \
BIND_ADDR=0.0.0.0:8080 DATA_DIR=/Users/eldin/Projects/Ovlive/data RUST_LOG=info,ovlive=debug \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=admin \
./target/debug/ovlive-server > /tmp/ovlive-server.log 2>&1 &
```

**In a worktree, point `DATA_DIR` and `.env` at the main checkout** — both are untracked, so
`.claude/worktrees/*/` has neither. `DATA_DIR=./data` there creates an empty directory, and an
empty one is a cache-cold boot: no snapshot, no `gtfs-nl.zip`, so the server **downloads the
232 MiB feed**. That is the one thing the data-source policy exists to prevent, and it happens
silently — the failure mode is a slow boot, not an error. Worktrees sharing one `data/` is
fine; only one server may run at a time anyway (see §6).

`GTFS_USER_AGENT` is required — the server exits with a named error if it is empty, which is
what you'll see if `.env` is missing (`cp .env.example .env` and set your own contact address).
Read from `.env` rather than written here on purpose: no contact address is committed to this
repo, so a clone can never fetch the feed under someone else's name. A boot from snapshot sends
no request at all, but a cache-cold one does.

Boot takes **~24 s** with `data/*.snap` present — most of it restoring the 325 MB GTFS
snapshot, then ~2 s building stop indexes. Wait for the log, don't poll the port:

```bash
until grep -qE 'listening on|ERROR|panic' /tmp/ovlive-server.log; do sleep 1; done
tail -15 /tmp/ovlive-server.log
```

A healthy boot logs, in order: `GTFS feed loaded (routes=3195 trips=~1.04M …)` →
`restored GTFS from parsed snapshot (no download)` → `stop indexes built for <today>` →
`subscribed stream=KV6` / `stream=NS InfoPlus` (the latter with
`topics=["/RIG/NStreinpositiesInterface5", "/RIG/InfoPlusRITInterface5"]`) →
`listening on http://0.0.0.0:8080`.

`restored N live trips (N pruned as stale)` is normal — snapshots older than
`STALE_TRIP_SECS` are discarded and refill from the feed within a minute.

If it instead logs a GTFS **download**, stop and investigate: boot order is
snapshot → cached `data/gtfs-nl.zip` → download, so a download means both caches were lost.

## 3. Frontend

```bash
pnpm install                                    # only if node_modules is stale
pnpm --filter @ovlive/web run dev > /tmp/ovlive-web.log 2>&1 &
```

**Read the actual port out of the log** — Vite silently falls back to 5174, 5175… when 5173
is taken:

```bash
grep -oE 'http://localhost:[0-9]+' /tmp/ovlive-web.log | head -1
```

**Landing on 5176+ does not mean OVLive is already running three times.** On this machine the
5173–5175 range is routinely held by *other* repos — `~/Work/situation-room` runs a `turbo dev`
stack per worktree, two of which were up during the 2026-08-07 session. Resolve every port to
its owner before concluding anything, and note that OVLive is a `react-router dev` while
situation-room is a bare `vite dev`:

```bash
for p in 5173 5174 5175 5176 8080; do
  pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null)
  [ -n "$pid" ] && echo "$p -> $(ps -o command= -p $pid | cut -c1-90)" || echo "$p free"
done
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

Trains ride a different feed, so check them separately — a few hundred nationally, ~98% of them
enriched from GTFS:

```bash
curl -s 'http://127.0.0.1:8080/v1/vehicles?bbox=3.0,50.5,7.5,53.7&types=train' |
  python3 -c 'import json,sys; v=json.load(sys.stdin)["vehicles"]; print(len(v), "trains,",
  sum(1 for x in v if x["line_public_number"]), "enriched,",
  sum(1 for x in v if x["delay_known"]), "with a known delay")'
```

`delay_known` climbs slowly from a cold start (RitInfo is published on change, not on a cycle —
see CLAUDE.md); `train_delays.snap` is what keeps it warm across restarts. Trains with
`delay_known: false` are correct behaviour, not a bug: their punctuality is genuinely unknown.

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

Kill by port, not by pattern — resolve the PID first:

```bash
kill $(lsof -nP -iTCP:8080 -sTCP:LISTEN -t)   # backend
kill $(lsof -nP -iTCP:5173 -sTCP:LISTEN -t)   # the frontend you started
```

**Do not `pkill -f 'react-router dev'`.** There are several OVLive worktrees under
`.claude/worktrees/`, all matching that pattern, so it kills every sibling's dev server —
including one a person or another session is using. That is how the 2026-08-07 session took
out a frontend on 5173 it had not started. The same applies to
`pkill -f 'target/debug/ovlive-server'`, which additionally matters because the survivor's
ZMQ subscriptions are the fair-use budget.

**Fair use — this matters.** Exactly one ZMQ SUB connection per NDOV datastream per
process. The server holds both (KV6 `:7658`, NS InfoPlus `:7664`), so
**stop the server before running any sampler in `crates/realtime/examples/`**
(`nslisten`, `nsdelay`) and never run two servers at once.
Note `:7664` counts as one datastream even though we subscribe to two envelopes on it — that
is why positions and RitInfo share a single connection.

To validate a GTFS parser change, use the cached zip — never re-fetch:

```bash
cargo run --release --example validate_feed -p ovlive-gtfs   # ~8 s, no network
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `password authentication failed` | Wrong Postgres port — use `docker port ovlive-pg 5432`, not `.env`'s 5432 |
| Boot hangs past ~30 s, or logs a GTFS download | `data/gtfs.snap` gone; it falls back to parsing the cached zip (slow but correct) |
| Boot re-parses after a code change | Bincode has no schema evolution — adding a field to `GtfsStore`/`LiveTrip` invalidates that snapshot. Self-healing, costs one full parse (~2 min in debug) |
| No trains on the map | `ZMQ_NS_ENABLED=false`, or the `:7664` subscription isn't delivering — check the `stream=NS InfoPlus` line |
| Every train says "on time" | `delay_known` is being ignored somewhere: unknown and on-time are both `delay_seconds: 0` |
| `live_vehicles: 0` | ZMQ not delivering; check `subscribed stream=` lines and the idle watchdog (`ZMQ_IDLE_TIMEOUT_SECS`) |
| SPA loads, map empty | Backend down or `VITE_API_BASE` wrong — check the browser's WS to `:8080/v1/stream` |
| Vite on an unexpected port | 5173–5175 taken — usually by another *repo* (see §3), not a stray OVLive one; read the port from the log |
| Backend downloads the feed in a worktree | `DATA_DIR=./data` resolved to the worktree's empty dir — point it at the main checkout (§2) |
| `just run` fails | It uses `set dotenv-load`, so it inherits `.env`'s wrong DB port. Prefer the explicit invocation above |
