# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The `justfile` is the entry point (`just --list`); it loads `.env` via `set dotenv-load`.
`just` is not always installed — the underlying commands work directly.

```bash
just build            # cargo build --workspace
just check            # cargo check + clippy --all-targets -D warnings
just test             # cargo test --workspace
just fmt              # cargo fmt --all
just run              # cargo run -p ovlive-server   (needs DATABASE_URL)
just up / just down   # docker compose (postgres + server)
just migrate          # sqlx migrate run (the server also migrates on boot)

cargo test --workspace --lib                    # 45 unit tests, no DB or network needed
cargo test -p ovlive-core blocks::              # one module
cargo test -p ovlive-core predicts_next_line_in_block -- --exact

pnpm install                                    # workspace: apps/*, packages/api-types
pnpm --filter @ovlive/web run dev               # SPA on :5173 (needs the backend up)
pnpm --filter @ovlive/web run typecheck         # react-router typegen && tsc
pnpm --filter @ovlive/web run build
```

The SPA points at `VITE_API_BASE`, defaulting to `http://127.0.0.1:8080` (`apps/web/app/lib/config.ts`).
No dev proxy is involved — the server sends permissive CORS and the WS connects cross-origin — so a
backend on another host/port just needs `VITE_API_BASE=http://host:port pnpm --filter @ovlive/web run dev`.

`cargo test --workspace` and `just check` (clippy `-D warnings`) are both green, including the
`crates/*/examples/` targets — keep them that way, since a stale example breaks the whole
workspace test build, not just itself.

### Running the backend locally

The binary does not read `.env` itself (no dotenvy) — pass env vars explicitly, and note
`GTFS_USER_AGENT` contains parentheses so `source .env` breaks:

```bash
DATABASE_URL=postgres://ovlive:ovlive@localhost:5432/ovlive \
DATA_DIR=./data RUST_LOG=info,ovlive=debug ./target/debug/ovlive-server
```

Postgres must be reachable (migrations + admin seed run at boot, or startup fails). Check the
actual published port — a `docker ps` container named `ovlive-pg` has been mapped to **5434**
on this machine, and hitting 5432 yields a misleading "password authentication failed".
With `data/*.snap` present the server boots from snapshots (no GTFS download) in ~15 s and
serves `http://0.0.0.0:8080`, docs at `/docs`.

### Diagnostic examples

`crates/realtime/examples/` holds throwaway live-feed samplers (`kv78listen.rs` and
`nslisten.rs` write Markdown reports to `data/`; `nextlinelive.rs` prints live predictions).
**Fair use: exactly one SUB connection per NDOV datastream — stop the server before running
one.** `nslisten.rs` dumps a raw NS treinposities message plus an element census, which is how
the train wire format below was established.

`crates/gtfs/examples/validate_feed.rs` needs **no network**: it parses the cached
`data/gtfs-nl.zip`, prints the counts the parser and stop indexes depend on, and asserts the
non-obvious ones. This is how to check a parser change (see the never-re-download policy):

```bash
cargo run --release --example validate_feed -p ovlive-gtfs   # ~8 s on the real feed
```

## Data-source policy (strict — read before touching `crates/gtfs` or `crates/realtime`)

The feeds are free, best-effort, community-run. Being a bad citizen gets the project blocked.

- **Identifying User-Agent.** `GTFS_USER_AGENT` must name the app *and* a contact address the
  operators can actually reach, in the form `OVLive/0.1 (+contact: you@example.com)`.
  **There is deliberately no default and no address anywhere in this repo**: `env_required` in
  `crates/server/src/config.rs` refuses to boot without it, `GtfsConfig` has no `Default` impl,
  and every example file and doc uses a placeholder. That is a de-personalisation requirement,
  not fussiness — this repo is public, so any committed address would make every unconfigured
  self-hosted instance fetch ~232 MiB/day under it, sending operator complaints to whoever
  happened to ship it. Never reintroduce a default, never commit a real address (not even the
  maintainer's — each deployment supplies its own via `.env` or the host environment), and never
  substitute a placeholder that doesn't resolve for an address that does.
- **Conditional requests only.** GTFS fetches send `If-None-Match` / `If-Modified-Since` from
  the persisted `FeedMeta` (`data/gtfs_meta.bin`); `304` means do nothing. One check per day at
  `GTFS_REFRESH_HOUR` local (`GTFS_REFRESH_TZ`).
- **Never re-download to re-parse.** The ~232 MiB archive is cached at `data/gtfs-nl.zip`.
  Boot order is snapshot → cached zip → download (`bootstrap_gtfs` in `crates/server/src/main.rs`).
  Parser changes must be validated against the cached zip, never by re-fetching.
- **Never buffer the archive in memory.** It is streamed to a `.part` file and atomically
  renamed; `stop_times.txt` is parsed by streaming the CSV out of the zip entry.
- **One ZMQ SUB connection per stream, per process.** KV6 (`:7658`), KV78Turbo (`:7817`) and
  NS InfoPlus (`:7664`) get one each. Reconnects use capped exponential backoff plus an idle
  watchdog. Port 7664 carries ten InfoPlus envelopes; we subscribe only to
  `/RIG/NStreinpositiesInterface5` so the other nine never hit the socket.
- Data is attributed to the operators via OVapi / NDOV Loket; OVLive is independent, no SLA.

## Architecture

Single Rust binary (`ovlive-server`) that ingests, holds state in memory, and serves the API.
Postgres holds **only** accounts and API keys — never vehicle data.

```
NDOV ZMQ KV6  (:7658, gzip XML)   → parse_kv6  → PosEvent      → LiveState (DashMap by vehicle)
NDOV ZMQ NS   (:7664, gzip XML)   → parse_ns   → PosEvent      ↗  (trains; not in KV6)
NDOV ZMQ KV78 (:7817, gzip pipes) → parse_kv78 → JourneyUpdate → BlockStore (next-line index)
OVapi gtfs-nl.zip (daily, 304-aware) → GtfsStore (ArcSwap, hot-swapped) → enriches LiveTrip
LiveState --(tick)--> Arc<VehicleIndex> (R-tree) --watch--> WS diff engine + REST snapshots
                                                                       ↘ data/*.snap
```

### Crates

| Crate | Role |
|---|---|
| `core` | Domain only, zero I/O: `LiveTrip`, trip lifecycle, `Filters`, R-tree `VehicleIndex`, RD→WGS84, `BlockStore`. Where the unit tests live. |
| `realtime` | ZMQ SUB loops + feed decoders (`kv6.rs` XML, `kv78.rs` pipe-delimited, `ns.rs` NS InfoPlus XML). Emits normalized events over mpsc. |
| `gtfs` | Conditional download, streaming zip/CSV parse, `GtfsService` (hot-swappable feed) implementing `core::Enricher`, plus the day-scoped `StopIndexes` behind the deprecated stops endpoints. |
| `persist` | Postgres accounts/keys (Argon2 passwords, SHA-256 key hashes) + generic gzip-bincode snapshots. |
| `api` | axum router: REST JSON, protobuf WS, auth extractors, rate limiting, embedded OpenAPI. |
| `proto` | Compiles `packages/proto/ovlive.proto` with prost + vendored `protoc`. |
| `server` | Wiring, env config, the tick loop, snapshot/prune schedules. |

### Design invariants worth knowing

- **CPU is the overriding constraint** (explicit product requirement). Nothing per-message is
  fanned out to clients. The server tick (`WS_TICK_HZ`, default 3) rebuilds one immutable
  `Arc<VehicleIndex>` and publishes it on a `watch` channel; each WS connection then does its own
  bbox query and emits ENTER/MOVE/LEAVE diffs at that same fixed rate. Upstream burst rate cannot
  translate into per-client work.
- **Trip lifecycle** (`core/src/state.rs::apply`): `INIT` replaces any prior trip for the vehicle;
  `END` removes it; a changed `journey_number` without an `END` is treated as a new trip; anything
  older than `STALE_TRIP_SECS` is swept. Vehicle id is `"<dataowner>:<vehicle_number>"`.
- **KV6 positions arrive as Rijksdriehoek (EPSG:28992) metres**, converted once on apply via the
  polynomial approximation in `core/src/rd.rs`. Bearing is derived from consecutive fixes and
  deliberately held when the vehicle barely moved (anti-jitter). NS train positions are already
  WGS84 and carry a GPS course, so `PosEvent` has both representations and `apply_fields` prefers
  whatever the feed gave: no round-trip through a projection, no bearing guessed from two fixes.
- **`delay_seconds` is only meaningful with `delay_known`.** Unknown and on-time are both `0`
  otherwise, and the UI rendered that as a green "on time" pill — asserting punctuality for
  trains, whose positions carry none. Anything reading delay must check the flag.
- **The KV6 ↔ GTFS join is `trips.txt.realtime_trip_id`** = `"<dataowner>:<lineplanningnumber>:<journeynumber>"`
  (e.g. `HTM:11:110002`) → `GtfsStore.trip_by_key`. This is the only reliable join; ~99% of live
  vehicles enrich (public line, type, operator, headsign, route colors).
  **`trip_by_key` collapses duplicates** (~2.1 trips share each realtime id — one per operating
  pattern — 486k ids for 1.04M trips). That is fine for enrichment, whose fields are
  day-invariant, but never invert it to ask "what is *this* trip's realtime id": the inverse
  names only one trip per id, so every other day's trip looks as though the feed gave it none.
  `TripInfo::realtime_trip_id` holds each trip's own value for that. (Inverting it is exactly
  how departure boards came to show no live vehicles at many stops.)
- **Enrichment is idempotent and lazy** — re-run only while `line_public_number` is still `None`,
  so a mid-run GTFS swap costs nothing.
- **State survives restarts via snapshots**, not the database: `gtfs.snap`, `realtime.snap`,
  `blocks.snap`, `train_delays.snap`, `gtfs_meta.bin` under `DATA_DIR` (gzip bincode, atomic temp+rename). Restored
  state is immediately pruned against `now`. Bincode has no schema evolution, so **adding a
  field to `GtfsStore`/`LiveTrip` invalidates the corresponding snapshot** — that is safe and
  self-healing (GTFS falls back to re-parsing the cached zip, live trips refill from the feed
  within a minute), but the first boot after such a change costs a full parse.
- **Auth is two-tier and data endpoints are public.** No key → anonymous access; this is what the
  official web app uses. A valid key → per-account and per-key limits. A *present but invalid* key
  → 401 (never a silent downgrade). Account/admin endpoints use HTTP Basic; the first boot seeds
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` if `users` is empty.
- **Rate limits are layered per IP / per account / per key** (`RateLimits` in
  `api/src/state.rs`), checked outermost-first. `PUBLIC_RATE_PER_MIN` is **per client IP** and set
  far higher than `USER_RATE_PER_MIN`, because the anonymous tier is one web-app visitor rather
  than all of them: it used to be a single process-wide bucket, where one scraper meant 429s for
  every visitor at once. The client IP comes from `CF-Connecting-IP`, else the leftmost
  `X-Forwarded-For`, **and only when the socket peer is loopback/private** — a request that reaches
  the port directly can't claim to be someone else. The keyed maps are swept every 60 s
  (`RateLimits::gc`); they're keyed on remote input, so nothing else bounds them.
- **`sqlx` uses runtime queries, not the `query!` macros**, so the workspace builds with no live
  database. Keep it that way.

### NS trains (the other non-obvious subsystem)

**Trains are not in KV6 at all.** They come from NS InfoPlus on datastream `:7664`, of whose ten
envelopes we take two — over **one** SUB connection, because fair use counts datastreams
(`run_infoplus_stream`, dispatching on the topic frame):

| envelope | gives | rate (measured) |
|---|---|---|
| `/RIG/NStreinpositiesInterface5` | position, speed, heading | full snapshot every ~11 s, ~300 KiB (14 KiB gzipped), ~294 trains / 375 material parts |
| `/RIG/InfoPlusRITInterface5` | punctuality, `TreinDatum`, `TreinSoort` code | ~0.95 msg/s, ~40 KiB/s, median 14 station blocks |

- **Vehicle id is `IFF:<TreinNummer>`** (e.g. `IFF:8743`), keyed by *train*, not by material
  part. `IFF` is not an operator code — it's the prefix gtfs-nl puts on every rail
  `realtime_trip_id`, so `LiveTrip::realtime_trip_id()` reproduces gtfs-nl's own
  `IFF:SPR:8743` and stop departure boards resolve trains through `by_rt_id` with no
  special-casing. The web app's operator table maps `IFF` → the NS brand.
- **One dot per train, from the lowest `Materieelvolgnummer`.** Coupled units each report their
  own GPS (measured: 216 trains with 1 part, 75 with 2, 3 with 3). Picking by *freshest* fix
  instead would flip between units every cycle and slide the dot along the train's length.
- **The feed republishes stale and future-dated fixes** — only 347/375 were current; the rest
  ranged from minutes to *two weeks* old, and two were dated 23:59 by a unit with no clock. Old
  fixes would appear and be pruned again on the next sweep (an ENTER/LEAVE flicker) and
  future-dated ones would never expire at all. Both ends are rejected in `parse_ns_treinposities`
  (`NS_MAX_FIX_AGE_SECS`, default 180 — keep it well under `STALE_TRIP_SECS`).
- **There is no lifecycle**: no INIT, no END. A train just stops appearing, and the staleness
  sweep removes it. Nothing infers an END from absence, so a GPS dropout in a tunnel freezes the
  dot rather than making it vanish and reappear.
- **The GTFS join is the bare train number** = `trips.txt.trip_short_name`, because the position
  feed publishes no line code and no operating day. `GtfsStore.train_trips` maps number → rail
  trips (`route_type` 2 only; gtfs-nl files rail-replacement buses under `IFF:` reusing the train
  number), and the day is resolved against `service_dates`: `TreinDatum` when RitInfo has given
  it, else the fix date, then the day before for after-midnight service. Candidates are
  deliberately **not** collapsed the way `trip_by_key` collapses them — a number is a different
  trip per operating pattern (median 2, max 34 across the feed). Measured **98% match** live
  (240/245); the misses are empty stock and units on no scheduled trip, which still render as
  trains because the parser sets `vehicle_type` itself.
- `line_public_number` is the **type code** (`IC`, `SPR`, `ICD`, …), not `route_short_name` —
  that's the prose "Intercity"/"Sprinter", too long for a map marker. Departure boards still show
  the prose name, which is what NS shows there.
- **Punctuality comes from RitInfo, and only for some trains.** `core/src/trains.rs` stores a
  *delay curve* per train — `(expected instant, delay)` per station — evaluated against `now` on
  every position update, because delay grows along a route and a scalar captured at receive time
  is wrong minutes later. Delay is actual − planned from the `Gepland`/`Actueel` pair; departure
  is preferred over arrival so a dwelling train isn't treated as past its station.
  - Cold-start coverage is genuinely partial: **34% of position-reporting trains within 5 min**
    (median 89 s to first mention), because RitInfo is published *on change* — a curve arrives
    when a journey is created, often hours ahead, and again when its delay is revised. Hence
    `train_delays.snap`, so a restart doesn't re-enter that window. Trains with no curve report
    `delay_known: false`, never a fabricated 0.
  - `/RIG/InfoPlusDVSInterface4` (departure boards) reached **72%** in the same window but at
    **6× the message rate** for the same bytes. RitInfo was chosen because it carries the whole
    journey in one message; add DVS alongside it if cold-start coverage matters more than CPU.
  - `crates/realtime/examples/nsdelay.rs` is this measurement — re-run it before changing source.
- **No next-line prediction for trains**: it comes from KV78Turbo, which carries no rail.
- Only **NS** trains report positions. Arriva, Blauwnet, Eurobahn etc. are in the schedule (and in
  `train_trips`) but never appear live.
- Not implemented, though RitInfo carries it: per-stop expected times and platform
  (`TreinVertrekSpoor`). Trains are the one mode where per-stop realtime *is* joinable — see the
  `UserStopCode` measurement below for why buses can't have it.

### Next-line prediction (the non-obvious subsystem)

"This vehicle continues as line X" comes from KV78Turbo block chaining, because the obvious
sources are empty in the NL feeds: **GTFS `block_id` is blank/placeholder and KV6 `blockcode` is
~0–2% filled**. The GTFS-derived `block_code` enrichment is effectively dead code.

`BlockStore` (`core/src/blocks.rs`) indexes KV78 journeys by `(dataowner, line_planning_number,
journey_number)` plus `(dataowner, block_code) → members`, and `predict_next` returns the soonest
block member starting after the current journey.

- **Resolve the block from the KV78 index, not the live KV6 `block_code`** — the live value is
  cleared shortly after journey start for RET. KV6 block is only a fallback for journeys absent
  from the index. (GVB predicts ~100% with zero KV6 block codes; keying off the live value was a
  measured regression.)
- **Low prediction rates for RET/HTM/QBUZZ are a feed limitation, not a bug**: NDOV publishes their
  next journey only ~1–7 min ahead, so successors are rarely co-resident. ARR/CXX/EBS/GVB/KEOLIS
  publish far ahead and hit 40–100%.
- KV78 is a firehose (~940 records/s nationally), hence `ZMQ_KV78_TOPICS` defaults to
  `/GOVI/KV8passtimes/`, per-message collapse to one update per journey, and a 60 s prune against
  `BLOCK_PRUNE_SECS`. `ZMQ_KV78_ENABLED=false` skips the whole subsystem.
- Investigated and rejected: NeTEx blocks (authoritative for 5 operators but **zero** for RET and
  QBUZZ), the `Vejo*` field cluster (mirrors the same journey), SIRI-VM (not in production in NL),
  KV1/KV4/KV15/KV17/KV19/KV20. A learned/inferred model was explicitly declined as too error-prone.

### Deprecated compatibility API (`crates/api/src/legacy.rs`) — temporary, delete when unused

12 endpoints exist **only** so third-party consumers of the pre-Rust (Go) OVLive API keep
working *unchanged* during migration. They are not the supported surface, nothing in `apps/web`
uses them, and they should be removed once traffic stops:

`/v1/realtime/{trips, trips/{id}/times, details/{id}, status/{id}, location/{id}, search,
journeyNumber/{id}, findIdByVehicleNumber}` and
`/v1/stops{, /search, /stoptimes, /{stopId}/stoptimes}`.

- **These are byte-compatible with the old API and must stay that way.** They deliberately
  violate this project's conventions: old paths (`journeyNumber`, `findIdByVehicleNumber`,
  `stoptimes`), camelCase JSON keys, capitalised enums (`"Bus"`, `"OnStop"`, `"None"`),
  `neLat`/`neLon`/`swLat`/`swLon` instead of `bbox`, `yyyyMMdd` `operatingDay`, and
  **plain-text** error bodies (`invalid neLat\n`, `404 page not found\n`) rather than the JSON
  envelope used elsewhere. Do not "modernise" any of it — that breaks the consumers it exists
  for. `legacy.rs` is the only place in the codebase where these conventions apply.
- **`id` is the old `realtimeTripId`** (`"<DataOwnerCode>:<LinePlanningNumber>:<JourneyNumber>"`),
  not the vehicle id. Path parameters accept either form — the reverse index is built once per
  tick in `VehicleIndex::by_rt_id`, never scanned per request — but responses always echo the
  old one.
- **Removal is one commit**: delete `legacy.rs`, its `.merge(legacy::router())` line, the
  `Deprecated` paths in `openapi.json`, and `LegacyLimits`. `LiveTrip::{last_kind, has_init,
  agency_id}`, `VehicleIndex::by_rt_id` and the extra GTFS columns are generally useful and can
  stay. `gtfs/src/stops.rs` can no longer go wholesale: the supported `/v1/stops/viewport` (the
  web app's stop layer) uses `StopIndexes::in_bbox`, so only `search`, the departure board
  (`calls`/`day_trips`/`calls_on_service_date`/`departures`) and their tests go with legacy —
  and with them the reason the index is day-scoped and rebuilt at midnight.
- Every response carries `Deprecation: true` and `Link: </docs>; rel="deprecation"`, so
  consumers are detectable; `openapi.json` marks them `deprecated` under a `Deprecated` tag.
  Those headers are additive — bodies are unchanged.
- Limits reuse the old env vars so existing tuning carries over: `MAX_VIEWPORT_AREA` (2.0 deg²,
  rejects larger viewports), `MAX_SPATIAL_RESULTS` (1500), `MAX_STOPS_RESULTS` (500). Note
  `/stoptimes` has **no window and no limit**, exactly as before — a busy stop returns its
  whole service day.
- Three unavoidable differences, all documented in the spec: ended trips 404 (the old SQL
  trip-history fallback has no equivalent, so `/times` always reports `active: true`);
  `realtimeArrival`/`realtimeDeparture` are always absent from `/times` (see the `UserStopCode`
  measurement below — both were `omitempty` pointers, so the shape holds); and viewport results
  are ordered nearest-to-centre where the old SQL had no `ORDER BY`.
- The old endpoints that needed SQL are **not** ported and were declined: vehicle-registry
  search, `/history/*`, `/analytics/*`. Postgres holds accounts only. `/ws/realtime` (old JSON
  protocol) is also not ported — use the protobuf `/v1/stream`.

**Stop departure boards are day-scoped on purpose.** `stop_times` is ~20.5M rows across the
feed's multi-week span; a full `stop_id -> stop_times` reverse index would cost hundreds of MB
on top of an already ~2 GB store. `StopIndexes` therefore indexes only the current service date
plus the previous one (for after-midnight service, whose GTFS times run past 24:00, shifted
onto today's seconds-since-midnight axis). Measured on the real feed: **2.54M calls, 12.4% of
`stop_times`, built in 0.4 s** — rebuilt on each feed swap and just after local midnight.
This is why `calendar_dates.txt` is now parsed: gtfs-nl ships **no `calendar.txt`**, so explicit
dates are the only way to know which of the 1.04M trips run today (~111k, 10.7%).

### BISON `UserStopCode` does not join to gtfs-nl stops (measured)

KV6/KV78 identify stops by `UserStopCode` (also `QuayCode` = `NL:Q:<code>`). Measured live over
3,000 vehicles (817 reporting a stop), it matches a GTFS **`stop_id` for 0%** and a
**`stop_code` for 30%** — and that 30% is essentially Connexxion alone:

| CXX | KEOLIS | EBS | ARR | QBUZZ | RET | GVB | HTM |
|---|---|---|---|---|---|---|---|
| 100% | 10% | 4.5% | 3.5% | 0.9% | 0% | 0% | 0% |

Consequences, so this isn't rediscovered the hard way:

- **There is no per-stop realtime data**, even though KV78Turbo publishes per-stop
  `ExpectedArrivalTime`/`ExpectedDepartureTime`/`TripStopStatus`. Retaining them was
  implemented and then **reverted**: it costs per-row work on a ~940 record/s firehose to
  enrich a minority of stops and none of the big city operators. Don't retry without first
  solving the code→stop mapping (an external CHB/quay mapping, or `UserStopOrderNumber` ↔
  `stop_sequence` if someone verifies that correspondence live).
- `/v1/realtime/trips/{id}/times` therefore returns schedule-only `scheduledArrival` /
  `scheduledDeparture`, and omits `realtimeArrival` / `realtimeDeparture` entirely.
- `LiveTrip::current_stop_id` is a `UserStopCode`: comparable only to `stops.stop_code`, never
  to `stop_id`. It is not a GTFS key.

## Contracts and cross-cutting conventions

- **`packages/proto/ovlive.proto` is the single source of truth for the WS wire format.** Rust
  types are generated at build time (`crates/proto/build.rs`, vendored protoc, no system install).
  The TS side does **not** codegen: `packages/api-types/src/proto.ts` raw-imports the `.proto` and
  parses it at runtime with protobufjs using `keepCase: true`, so **wire objects keep snake_case
  field names**. The `just proto-ts` target is stale — `@ovlive/api-types` has no `generate` script.
  The hand-written TS interfaces in `packages/api-types/src/types.ts` / `ws.ts` must be updated by
  hand when the proto changes.
- **REST is JSON and is documented by a hand-written `crates/api/openapi.json`**, embedded with
  `include_str!` and served at `/openapi.json` + `/docs` (Scalar). Adding or changing a route means
  editing that file too — nothing validates it against the router.
- **A backend contract change is not "done" until the frontend uses it.** `apps/web` is a working
  React Router 7 SPA (SSR off) with MapLibre: `MapView`, `VehiclePanel` (tabs, follow, isolate,
  upcoming stops, "continues as" card), `FiltersPanel`, NL/EN i18n in `app/lib/i18n.tsx`. It talks
  to the backend only through `@ovlive/api-types` (`LiveClient` WS + `RestClient`), aliased to
  source by `apps/web/vite.config.ts`. Check `apps/web` before claiming a feature is user-visible.
- **The stop layer is REST, not the live stream.** Stops change only when the daily GTFS feed
  swaps, so `MapView` fetches `GET /v1/stops/viewport` (supported; unrelated to the deprecated
  `/v1/stops`) for a box padded 35% around the view and re-asks only when the user pans outside
  it. Drawn from zoom 14, named from 15.5, and toggleable in the settings panel (persisted in
  `localStorage`, default on). The server rejects boxes over 1 deg² and caps at 800/2000 stops —
  a zoomed-out country view would otherwise serialise tens of thousands of quays per pan on a
  keyless endpoint. Labels drop the `"<place>, "` prefix gtfs-nl puts on every stop name.
- **Clicking a stop opens a departure board** (`StopPanel`, fed by `GET /v1/stops/{stopId}/departures`,
  polled every 12 s). It is **quay-scoped, not station-scoped** — the clicked dot is one direction
  of a multi-quay stop, which is also what makes the board coherent. Rows whose trip has a live
  vehicle (`vehicle_id` non-null, resolved through `VehicleIndex::by_rt_id` keyed on that trip's
  own `TripInfo::realtime_trip_id`) are buttons that pan
  to that vehicle and select it, closing the board; the rest are schedule-only, because a vehicle
  only enters the feed once its journey starts, so the *next* departure is often not yet trackable.
  `expected_departure` applies the vehicle's **trip-level** delay — there is no per-stop realtime
  to use (see the `UserStopCode` measurement above) — and only when the vehicle actually reported
  one: `delay_seconds` is `null`, not `0`, for a live train whose RitInfo we haven't seen.
  The board replaces the vehicle panel while
  open (they share `.vpanel`, so both get the desktop dock / mobile sheet and `panelAwareOffset`),
  leaving the vehicle selection intact underneath, and opening one stops following so the camera
  isn't dragged off. Times are seconds-since-local-midnight, the same axis as `upcoming_stops`.
- `apps/mobile` (Expo, Phase 3) does not exist yet. `migrations/0001` reserves a `trip_history`
  table for Phase 4 that nothing writes to.
- Comments explain *why* (feed quirks, policy, CPU trade-offs), not *what*. Match that: the
  non-obvious constraints in this codebase are almost all upstream-data facts that were measured
  live, so record the measurement alongside the code.
