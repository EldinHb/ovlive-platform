//! **Deprecated compatibility endpoints — scheduled for removal.**
//!
//! A byte-compatible reimplementation of the pre-Rust (Go) OVLive API, so existing
//! third-party consumers keep working unchanged during migration. They are *not* the
//! supported API and must be deleted once traffic to them stops. Nothing in `apps/web`
//! uses them.
//!
//! Because compatibility is the whole point, these endpoints deliberately **do not** follow
//! this project's conventions. They keep the old paths (`journeyNumber`,
//! `findIdByVehicleNumber`, `stoptimes`), the old camelCase JSON keys, the old capitalised
//! enum values (`"Bus"`, `"OnStop"`), the old `neLat`/`neLon`/`swLat`/`swLon` viewport
//! parameters, the old `yyyyMMdd` `operatingDay`, and the old plain-text error bodies.
//! Do not "fix" any of that — it would break the consumers this exists for. New work belongs
//! on `/v1/vehicles*` instead:
//!
//! | Deprecated                                    | Use instead                                |
//! |-----------------------------------------------|--------------------------------------------|
//! | `GET /v1/realtime/trips`                      | `GET /v1/vehicles?bbox=`                   |
//! | `GET /v1/realtime/search`                     | `GET /v1/vehicles?search=`                 |
//! | `GET /v1/realtime/details/{id}`               | `GET /v1/vehicles/{id}`                    |
//! | `GET /v1/realtime/status\|location/{id}`       | `GET /v1/vehicles/{id}`                    |
//! | `GET /v1/realtime/journeyNumber/{id}`         | `GET /v1/vehicles/{id}`                    |
//! | `GET /v1/realtime/findIdByVehicleNumber`      | id *is* `<dataowner>:<vehicle_number>`     |
//! | `GET /v1/realtime/trips/{id}/times`           | no replacement yet                         |
//! | `GET /v1/stops*`                              | no replacement yet                         |
//!
//! **`id` here is the old `realtimeTripId`** — `"<DataOwnerCode>:<LinePlanningNumber>:
//! <JourneyNumber>"` (e.g. `RET:M1:1001`), *not* this API's `<dataowner>:<vehicle_number>`
//! vehicle id. Path parameters accept either form for convenience, but every response echoes
//! the old one.
//!
//! Response types below mirror the Go structs in `handler/responses.go` one-for-one, in the
//! same field order, with `skip_serializing_if` wherever the original had `omitempty` — a
//! nil pointer was *absent* from the old JSON, not `null`.
//!
//! Known, unavoidable differences from the Go original (all documented in `openapi.json`):
//!
//! - **Ended trips 404.** `/times` and `/journeyNumber` used to fall back to a SQL trip-history
//!   table; this server persists no vehicle history, so only live trips resolve and `active`
//!   is always `true`.
//! - **`realtimeArrival` / `realtimeDeparture` are always absent** from `/times`. They came
//!   from per-stop realtime passages, which cannot be joined to gtfs-nl — see the
//!   `UserStopCode` measurement in CLAUDE.md. Both were `omitempty` pointers, so their absence
//!   is shape-compatible.
//! - **Viewport results are ordered** nearest-to-centre rather than in arbitrary database
//!   order (the old SQL had no `ORDER BY`).
//!
//! Every response also carries `Deprecation: true` and `Link: </docs>; rel="deprecation"`, so
//! remaining consumers are detectable. Those are additive headers; bodies are unchanged.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, Utc};
use ovlive_core::{BBox, Filters, LiveTrip, MessageKind, VehicleType};
use ovlive_gtfs::{local_midnight_utc, StopInfo};
use serde::{Deserialize, Serialize};

use crate::auth::OptionalApiKeyUser;
use crate::state::AppState;

/// Where the deprecation `Link` header points.
const DEPRECATION_DOCS: &str = "</docs>; rel=\"deprecation\"; type=\"text/html\"";

/// The old API capped trip search at 10 results, in the handler rather than by parameter.
const SEARCH_LIMIT: usize = 10;
/// The old `SearchStops` SQL capped the number of distinct *names* at 20.
const STOP_SEARCH_NAME_LIMIT: usize = 20;

/// All deprecated routes, with the deprecation headers applied once for the whole group.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/realtime/trips", get(trips))
        .route("/v1/realtime/trips/:id/times", get(trip_times))
        .route("/v1/realtime/details/:id", get(details))
        .route("/v1/realtime/status/:id", get(status))
        .route("/v1/realtime/location/:id", get(status))
        .route("/v1/realtime/search", get(search))
        .route("/v1/realtime/journeyNumber/:id", get(journey_number))
        .route("/v1/realtime/findIdByVehicleNumber", get(find_id))
        .route("/v1/stops", get(stops_in_viewport))
        .route("/v1/stops/search", get(stops_search))
        .route("/v1/stops/stoptimes", get(multi_stop_times))
        .route("/v1/stops/:stopId/stoptimes", get(stop_times))
        .layer(axum::middleware::from_fn(mark_deprecated))
}

/// Tag every response from this group as deprecated (RFC 8594-style advertisement).
async fn mark_deprecated(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("deprecation", HeaderValue::from_static("true"));
    h.insert(header::LINK, HeaderValue::from_static(DEPRECATION_DOCS));
    res
}

// ----------------------------------------------------------------------------
// Old wire-format helpers
//
// The old server used Go's `http.Error` / `http.NotFound`, which emit plain text with a
// trailing newline — not this API's JSON error envelope. Consumers may be matching on those
// bodies, so they are reproduced verbatim.
// ----------------------------------------------------------------------------

fn text_err(code: StatusCode, msg: &str) -> Response {
    (
        code,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("{msg}\n"),
    )
        .into_response()
}

/// Go's `http.NotFound`.
fn not_found() -> Response {
    text_err(StatusCode::NOT_FOUND, "404 page not found")
}

fn internal_error() -> Response {
    text_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
}

/// `domain.TransportType` — capitalised, unlike this API's lowercase `vehicle_type`.
fn transport_type(t: VehicleType) -> &'static str {
    match t {
        VehicleType::Bus => "Bus",
        VehicleType::Tram => "Tram",
        VehicleType::Metro => "Metro",
        VehicleType::Train => "Train",
        VehicleType::Ferry => "Ferry",
        VehicleType::Unknown => "Unknown",
    }
}

/// `domain.VehicleState`. The old KV6 parser had no state for `DELAY` messages and dropped
/// them, so a delay-only trip reports the zero value `"None"`.
fn vehicle_state(k: Option<MessageKind>) -> &'static str {
    match k {
        Some(MessageKind::Init) => "Init",
        Some(MessageKind::Arrival) => "Arrival",
        Some(MessageKind::Departure) => "Departure",
        Some(MessageKind::OnStop) => "OnStop",
        Some(MessageKind::OnRoute) => "OnRoute",
        Some(MessageKind::Offroute) => "OffRoute",
        Some(MessageKind::End) => "End",
        Some(MessageKind::Delay) | None => "None",
    }
}

/// The old `id`: `"<DataOwnerCode>:<LinePlanningNumber>:<JourneyNumber>"`. Falls back to the
/// vehicle id for the rare trip whose line/journey KV6 hasn't reported yet.
fn old_id(t: &LiveTrip) -> String {
    t.realtime_trip_id().unwrap_or_else(|| t.id.clone())
}

/// `RealtimeTrip.ServiceDate` is `yyyyMMdd`; KV6's operating day is `YYYY-MM-DD`.
fn service_date_compact(t: &LiveTrip) -> String {
    t.operating_day
        .as_deref()
        .map(|d| d.replace('-', ""))
        .unwrap_or_default()
}

fn operating_day(t: &LiveTrip) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(t.operating_day.as_deref()?, "%Y-%m-%d").ok()
}

/// Go's `time.RFC3339` on a UTC instant: second precision, `Z` suffix.
fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Seconds-since-local-midnight schedule value as an absolute UTC instant.
fn absolute(day: Option<NaiveDate>, secs: i32, tz: chrono_tz::Tz) -> Option<DateTime<Utc>> {
    Some(local_midnight_utc(day?, tz)? + Duration::seconds(secs as i64))
}

/// Resolve either id form to a live trip.
fn resolve(state: &AppState, id: &str) -> Option<LiveTrip> {
    if let Some(t) = state.live.get(id) {
        return Some(t);
    }
    state.latest_index().get_by_realtime_trip_id(id).cloned()
}

// ----------------------------------------------------------------------------
// Viewport
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ViewportQuery {
    #[serde(rename = "neLat")]
    pub ne_lat: Option<String>,
    #[serde(rename = "neLon")]
    pub ne_lon: Option<String>,
    #[serde(rename = "swLat")]
    pub sw_lat: Option<String>,
    #[serde(rename = "swLon")]
    pub sw_lon: Option<String>,
    pub ids: Option<String>,
}

/// The old API's viewport rejections, reproduced verbatim as plain text.
enum ViewportError {
    /// `invalid neLat` and friends.
    Field(&'static str),
    Bounds,
    TooLarge,
}

impl ViewportError {
    fn response(self) -> Response {
        let msg = match self {
            ViewportError::Field(name) => format!("invalid {name}"),
            ViewportError::Bounds => "invalid viewport bounds".into(),
            ViewportError::TooLarge => "viewport too large".into(),
        };
        text_err(StatusCode::BAD_REQUEST, &msg)
    }
}

/// `handler.parseViewport` + `domain.Viewport.Validate`.
fn parse_viewport(q: &ViewportQuery, max_area: f64) -> Result<BBox, ViewportError> {
    fn field(name: &'static str, raw: &Option<String>) -> Result<f64, ViewportError> {
        raw.as_deref()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .ok_or(ViewportError::Field(name))
    }
    let ne_lat = field("neLat", &q.ne_lat)?;
    let ne_lon = field("neLon", &q.ne_lon)?;
    let sw_lat = field("swLat", &q.sw_lat)?;
    let sw_lon = field("swLon", &q.sw_lon)?;

    if ne_lat <= sw_lat || ne_lon <= sw_lon {
        return Err(ViewportError::Bounds);
    }
    if max_area > 0.0 && (ne_lat - sw_lat) * (ne_lon - sw_lon) > max_area {
        return Err(ViewportError::TooLarge);
    }
    Ok(BBox {
        min_lat: sw_lat,
        min_lon: sw_lon,
        max_lat: ne_lat,
        max_lon: ne_lon,
    })
}

// ----------------------------------------------------------------------------
// Response types — mirror `handler/responses.go` field-for-field, in order.
// ----------------------------------------------------------------------------

#[derive(Serialize)]
struct TripListResponse {
    trips: Vec<TripSummary>,
}

#[derive(Serialize)]
struct TripSummary {
    id: String,
    agency: String,
    #[serde(rename = "transportType")]
    transport_type: &'static str,
    #[serde(rename = "vehicleNumber")]
    vehicle_number: String,
    lat: f64,
    lon: f64,
    line: String,
    timestamp: String,
}

impl From<&LiveTrip> for TripSummary {
    fn from(t: &LiveTrip) -> Self {
        TripSummary {
            id: old_id(t),
            agency: t.agency_id.clone().unwrap_or_default(),
            transport_type: transport_type(t.vehicle_type),
            vehicle_number: t.key.vehicle_number.clone(),
            lat: t.lat,
            lon: t.lon,
            line: t.line_public_number.clone().unwrap_or_default(),
            timestamp: rfc3339(t.last_update),
        }
    }
}

#[derive(Serialize)]
struct TripDetailsResponse {
    id: String,
    #[serde(rename = "dataOwner")]
    data_owner: String,
    line: String,
    #[serde(rename = "journeyNumber")]
    journey_number: String,
    #[serde(rename = "vehicleNumbers")]
    vehicle_numbers: Vec<String>,
    headsign: String,
    description: String,
    #[serde(rename = "omloopNumber", skip_serializing_if = "Option::is_none")]
    omloop_number: Option<String>,
    #[serde(rename = "operatingDay")]
    operating_day: String,
    shapes: Vec<ShapePoint>,
    #[serde(rename = "transportType")]
    transport_type: &'static str,
    stops: Vec<TripStop>,
    #[serde(rename = "hasInit")]
    has_init: bool,
}

#[derive(Serialize)]
struct ShapePoint {
    lat: f64,
    lon: f64,
    order: usize,
}

#[derive(Serialize)]
struct TripStop {
    name: String,
    #[serde(rename = "arrivalTime")]
    arrival_time: String,
    #[serde(rename = "userStopOrder")]
    user_stop_order: u32,
    #[serde(rename = "userStopCode", skip_serializing_if = "Option::is_none")]
    user_stop_code: Option<String>,
    lat: f64,
    lon: f64,
}

#[derive(Serialize)]
struct StatusResponse {
    punctuality: i32,
    state: &'static str,
    #[serde(rename = "userStopCode")]
    user_stop_code: String,
    /// Marshalled like Go's `time.Time`: RFC3339 keeping any sub-second precision. (The old
    /// `/trips` handler formatted with `time.RFC3339` instead, hence second precision there —
    /// that inconsistency is original.)
    timestamp: DateTime<Utc>,
    lat: f64,
    lon: f64,
}

#[derive(Serialize)]
struct JourneyNumberResponse {
    #[serde(rename = "journeyNumber")]
    journey_number: String,
}

#[derive(Serialize)]
struct FindIdResponse {
    id: String,
}

#[derive(Serialize)]
struct SearchResponse {
    items: Vec<SearchItem>,
}

#[derive(Serialize)]
struct SearchItem {
    agency: String,
    #[serde(rename = "transportType")]
    transport_type: &'static str,
    #[serde(rename = "vehicleNumbers")]
    vehicle_numbers: Vec<String>,
    lat: f64,
    lon: f64,
    line: String,
    id: String,
    timestamp: String,
    headsign: String,
    description: String,
    punctuality: i32,
}

#[derive(Serialize)]
struct TripTimesResponse {
    id: String,
    active: bool,
    line: String,
    #[serde(skip_serializing_if = "str::is_empty")]
    headsign: String,
    #[serde(rename = "transportType", skip_serializing_if = "str::is_empty")]
    transport_type: &'static str,
    punctuality: i32,
    #[serde(skip_serializing_if = "str::is_empty")]
    state: &'static str,
    #[serde(rename = "operatingDay")]
    operating_day: String,
    stops: Vec<TripTimeStop>,
}

#[derive(Serialize)]
struct TripTimeStop {
    #[serde(rename = "stopName")]
    stop_name: String,
    #[serde(rename = "userStopCode", skip_serializing_if = "Option::is_none")]
    user_stop_code: Option<String>,
    #[serde(rename = "stopSequence")]
    stop_sequence: u32,
    #[serde(rename = "scheduledArrival")]
    scheduled_arrival: String,
    #[serde(rename = "scheduledDeparture")]
    scheduled_departure: String,
    /// Always `None` — see the module docs. Kept so the shape stays documented.
    #[serde(rename = "realtimeArrival", skip_serializing_if = "Option::is_none")]
    realtime_arrival: Option<DateTime<Utc>>,
    #[serde(rename = "realtimeDeparture", skip_serializing_if = "Option::is_none")]
    realtime_departure: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct StopListResponse {
    stops: Vec<StopSummary>,
}

/// `platformCode` was scanned but never assigned by the old handler, so it was always
/// omitted — the field is therefore absent here too.
#[derive(Serialize)]
struct StopSummary {
    #[serde(rename = "stopId")]
    stop_id: String,
    #[serde(rename = "stopName")]
    stop_name: String,
    lat: f64,
    lon: f64,
}

impl From<&StopInfo> for StopSummary {
    fn from(s: &StopInfo) -> Self {
        StopSummary {
            stop_id: s.stop_id.clone(),
            stop_name: s.name.clone(),
            lat: s.lat,
            lon: s.lon,
        }
    }
}

#[derive(Serialize)]
struct StopSearchResponse {
    stops: Vec<StopSearchResult>,
}

#[derive(Serialize)]
struct StopSearchResult {
    #[serde(rename = "stopName")]
    stop_name: String,
    stops: Vec<StopSearchStop>,
}

#[derive(Serialize)]
struct StopSearchStop {
    #[serde(rename = "stopId")]
    stop_id: String,
    #[serde(rename = "stopCode", skip_serializing_if = "Option::is_none")]
    stop_code: Option<String>,
    lat: f64,
    lon: f64,
}

#[derive(Serialize)]
struct StopTimesResponse {
    #[serde(rename = "stopTimes")]
    stop_times: Vec<StopTimeItem>,
}

#[derive(Serialize)]
struct StopTimeItem {
    #[serde(rename = "realtimeTripId")]
    realtime_trip_id: String,
    #[serde(rename = "stopId")]
    stop_id: String,
    #[serde(rename = "lineNumber", skip_serializing_if = "Option::is_none")]
    line_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agency: Option<String>,
    #[serde(rename = "vehicleNumber", skip_serializing_if = "Option::is_none")]
    vehicle_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    punctuality: Option<i32>,
    #[serde(rename = "scheduledArrival")]
    scheduled_arrival: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    headsign: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    longitude: Option<f64>,
}

// ----------------------------------------------------------------------------
// Realtime
// ----------------------------------------------------------------------------

/// `GET /v1/realtime/trips` — **deprecated**, use `GET /v1/vehicles?bbox=`.
async fn trips(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<ViewportQuery>,
) -> Response {
    let bbox = match parse_viewport(&q, state.legacy.max_viewport_area) {
        Ok(b) => b,
        Err(e) => return e.response(),
    };
    let idx = state.latest_index();

    let mut trips: Vec<TripSummary> = idx
        .query(bbox, &Filters::default())
        .into_iter()
        .take(state.legacy.max_spatial_results)
        .map(TripSummary::from)
        .collect();

    // The old handler appended explicitly-requested ids to the viewport hits.
    if let Some(extra) = q.ids.as_deref() {
        for id in extra.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if let Some(t) = idx.get_any(id) {
                let summary = TripSummary::from(t);
                if !trips.iter().any(|s| s.id == summary.id) {
                    trips.push(summary);
                }
            }
        }
    }

    Json(TripListResponse { trips }).into_response()
}

/// `GET /v1/realtime/details/{id}` — **deprecated**, use `GET /v1/vehicles/{id}`.
async fn details(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(trip) = resolve(&state, &id) else {
        return not_found();
    };
    // The old store carried a numeric GTFS trip id; an unmatched trip (`TripID == 0`) 404'd.
    let Some(matched) = trip.matched_trip_id.clone() else {
        return not_found();
    };
    let Some(store) = state.gtfs.current() else {
        return internal_error();
    };

    // `COALESCE(r.route_long_name, '')` / `COALESCE(t.trip_headsign, '')`, both defaulting to
    // "-" when the trip row is missing entirely.
    let (headsign, description) = match store.trip(&matched) {
        Some(t) => (
            t.headsign.clone(),
            store
                .route(&t.route_id)
                .map(|r| r.long_name.clone())
                .unwrap_or_default(),
        ),
        None => ("-".to_string(), "-".to_string()),
    };

    let shapes: Vec<ShapePoint> = store
        .shape_of_trip(&matched)
        .map(|pts| {
            pts.iter()
                .enumerate()
                .map(|(i, p)| ShapePoint {
                    lat: p[0],
                    lon: p[1],
                    order: i + 1,
                })
                .collect()
        })
        .unwrap_or_default();

    let day = operating_day(&trip);
    let stops: Vec<TripStop> = store
        .stop_times
        .get(&matched)
        .map(|times| {
            times
                .iter()
                .filter_map(|st| {
                    // The old SQL inner-joined stops, and the handler skipped rows whose
                    // arrival time wasn't `HH:MM:SS`.
                    let stop = store.stop(&st.stop_id)?;
                    Some(TripStop {
                        name: if stop.name.is_empty() {
                            "-".into()
                        } else {
                            stop.name.clone()
                        },
                        arrival_time: rfc3339(absolute(day, st.arrival, state.tz)?),
                        user_stop_order: st.stop_sequence,
                        user_stop_code: stop.code.clone(),
                        lat: stop.lat,
                        lon: stop.lon,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Json(TripDetailsResponse {
        id: old_id(&trip),
        data_owner: trip.key.dataowner.clone(),
        line: trip.line_public_number.clone().unwrap_or_default(),
        journey_number: trip.journey_number.clone().unwrap_or_default(),
        vehicle_numbers: vec![trip.key.vehicle_number.clone()],
        headsign,
        description,
        omloop_number: trip.block_code.clone(),
        operating_day: service_date_compact(&trip),
        shapes,
        transport_type: transport_type(trip.vehicle_type),
        stops,
        has_init: trip.has_init,
    })
    .into_response()
}

/// `GET /v1/realtime/status/{id}` and `GET /v1/realtime/location/{id}` — **deprecated**,
/// use `GET /v1/vehicles/{id}`. The old API served both paths from one handler.
async fn status(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(t) = resolve(&state, &id) else {
        return not_found();
    };
    Json(StatusResponse {
        punctuality: t.delay_seconds,
        state: vehicle_state(t.last_kind),
        user_stop_code: t.current_stop_id.clone().unwrap_or_default(),
        timestamp: t.last_update,
        lat: t.lat,
        lon: t.lon,
    })
    .into_response()
}

/// `GET /v1/realtime/journeyNumber/{id}` — **deprecated**, use `GET /v1/vehicles/{id}`.
/// The old handler fell back to a SQL lookup for ended trips; that data isn't persisted here,
/// so the fallback consults the GTFS schedule instead.
async fn journey_number(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if let Some(t) = resolve(&state, &id) {
        return Json(JourneyNumberResponse {
            journey_number: t.journey_number.clone().unwrap_or_default(),
        })
        .into_response();
    }
    let parts: Vec<&str> = id.splitn(3, ':').collect();
    if parts.len() != 3 {
        return not_found();
    }
    let known = state
        .gtfs
        .current()
        .is_some_and(|s| s.trip_by_key.contains_key(&id));
    if !known {
        return not_found();
    }
    Json(JourneyNumberResponse {
        journey_number: parts[2].to_string(),
    })
    .into_response()
}

#[derive(Deserialize)]
pub struct FindIdQuery {
    #[serde(rename = "vehicleNumber")]
    pub vehicle_number: Option<String>,
    #[serde(rename = "dataOwner")]
    pub data_owner: Option<String>,
}

/// `GET /v1/realtime/findIdByVehicleNumber` — **deprecated**. In this API the vehicle id is
/// simply `<dataowner>:<vehicle_number>`; the old one returned the `realtimeTripId`.
async fn find_id(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<FindIdQuery>,
) -> Response {
    let number = q.vehicle_number.unwrap_or_default();
    let owner = q.data_owner.unwrap_or_default();
    if number.is_empty() || owner.is_empty() {
        return text_err(
            StatusCode::BAD_REQUEST,
            "vehicleNumber and dataOwner are required",
        );
    }
    match state.live.get(&format!("{owner}:{number}")) {
        Some(t) => Json(FindIdResponse { id: old_id(&t) }).into_response(),
        None => not_found(),
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// `GET /v1/realtime/search` — **deprecated**, use `GET /v1/vehicles?search=`.
/// At most 10 results, as the old handler hard-coded.
async fn search(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Response {
    let query = q.q.unwrap_or_default();
    if query.is_empty() {
        return Json(SearchResponse { items: Vec::new() }).into_response();
    }
    let store = state.gtfs.current();
    let filters = Filters {
        search: query,
        ..Default::default()
    };
    let items: Vec<SearchItem> = state
        .latest_index()
        .all(&filters)
        .into_iter()
        .take(SEARCH_LIMIT)
        .map(|t| {
            // `headsign` / `description` came from a GTFS lookup and were "" when unmatched.
            let (headsign, description) = t
                .matched_trip_id
                .as_deref()
                .and_then(|tid| store.as_ref().and_then(|s| s.trip(tid).map(|i| (s, i))))
                .map(|(s, i)| {
                    (
                        i.headsign.clone(),
                        s.route(&i.route_id)
                            .map(|r| r.long_name.clone())
                            .unwrap_or_default(),
                    )
                })
                .unwrap_or_default();
            SearchItem {
                agency: t.agency_id.clone().unwrap_or_default(),
                transport_type: transport_type(t.vehicle_type),
                vehicle_numbers: vec![t.key.vehicle_number.clone()],
                lat: t.lat,
                lon: t.lon,
                line: t.line_public_number.clone().unwrap_or_default(),
                id: old_id(t),
                timestamp: rfc3339(t.last_update),
                headsign,
                description,
                punctuality: t.delay_seconds,
            }
        })
        .collect();

    Json(SearchResponse { items }).into_response()
}

/// `GET /v1/realtime/trips/{id}/times` — **deprecated**, no replacement yet. See the module
/// docs for the two known differences (absent `realtime*` times, ended trips 404).
async fn trip_times(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(trip) = resolve(&state, &id) else {
        return not_found();
    };
    let Some(matched) = trip.matched_trip_id.clone() else {
        return not_found();
    };
    let Some(store) = state.gtfs.current() else {
        return internal_error();
    };

    let headsign = store
        .trip(&matched)
        .map(|t| t.headsign.clone())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "-".into());

    let day = operating_day(&trip);
    let stops: Vec<TripTimeStop> = store
        .stop_times
        .get(&matched)
        .map(|times| {
            times
                .iter()
                .filter_map(|st| {
                    let stop = store.stop(&st.stop_id)?;
                    Some(TripTimeStop {
                        stop_name: if stop.name.is_empty() {
                            "-".into()
                        } else {
                            stop.name.clone()
                        },
                        user_stop_code: stop.code.clone(),
                        stop_sequence: st.stop_sequence,
                        scheduled_arrival: rfc3339(absolute(day, st.arrival, state.tz)?),
                        scheduled_departure: absolute(day, st.departure, state.tz)
                            .map(rfc3339)
                            .unwrap_or_default(),
                        realtime_arrival: None,
                        realtime_departure: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Json(TripTimesResponse {
        id: old_id(&trip),
        active: true,
        line: trip.line_public_number.clone().unwrap_or_default(),
        headsign,
        transport_type: transport_type(trip.vehicle_type),
        punctuality: trip.delay_seconds,
        state: vehicle_state(trip.last_kind),
        operating_day: service_date_compact(&trip),
        stops,
    })
    .into_response()
}

// ----------------------------------------------------------------------------
// Stops
// ----------------------------------------------------------------------------

/// The old server was SQL-backed and always had stop data; this one needs the day-scoped
/// indexes built first, so a cold boot reports the old generic 500.
fn indexes_unavailable() -> Response {
    internal_error()
}

/// `GET /v1/stops` — **deprecated**, no replacement yet.
async fn stops_in_viewport(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<ViewportQuery>,
) -> Response {
    let bbox = match parse_viewport(&q, state.legacy.max_viewport_area) {
        Ok(b) => b,
        Err(e) => return e.response(),
    };
    let Some(idx) = state.gtfs.stop_indexes() else {
        return indexes_unavailable();
    };
    let stops: Vec<StopSummary> = idx
        .in_bbox(
            bbox.min_lat,
            bbox.min_lon,
            bbox.max_lat,
            bbox.max_lon,
            state.legacy.max_stops_results,
        )
        .into_iter()
        .map(StopSummary::from)
        .collect();

    Json(StopListResponse { stops }).into_response()
}

/// `GET /v1/stops/search` — **deprecated**, no replacement yet. Results are grouped by stop
/// name, preserving the ranked order, exactly as the old handler did.
async fn stops_search(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Response {
    let query = q.q.unwrap_or_default().trim().to_string();
    if query.chars().count() < 2 {
        return text_err(
            StatusCode::BAD_REQUEST,
            "query must be at least 2 characters",
        );
    }
    let Some(idx) = state.gtfs.stop_indexes() else {
        return indexes_unavailable();
    };

    let mut stops: Vec<StopSearchResult> = Vec::new();
    for s in idx.search(&query, STOP_SEARCH_NAME_LIMIT) {
        let entry = StopSearchStop {
            stop_id: s.stop_id.clone(),
            stop_code: s.code.clone(),
            lat: s.lat,
            lon: s.lon,
        };
        match stops.iter_mut().find(|g| g.stop_name == s.name) {
            Some(group) => group.stops.push(entry),
            None => stops.push(StopSearchResult {
                stop_name: s.name.clone(),
                stops: vec![entry],
            }),
        }
    }

    Json(StopSearchResponse { stops }).into_response()
}

#[derive(Deserialize)]
pub struct MultiStopTimesQuery {
    #[serde(rename = "stopIds")]
    pub stop_ids: Option<String>,
}

/// `GET /v1/stops/stoptimes` — **deprecated**, no replacement yet.
async fn multi_stop_times(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<MultiStopTimesQuery>,
) -> Response {
    let raw = q.stop_ids.unwrap_or_default();
    if raw.trim().is_empty() {
        return text_err(StatusCode::BAD_REQUEST, "stopIds parameter is required");
    }
    let ids: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    stop_times_for(&state, &ids)
}

/// `GET /v1/stops/{stopId}/stoptimes` — **deprecated**, no replacement yet.
async fn stop_times(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(stop_id): Path<String>,
) -> Response {
    stop_times_for(&state, &[stop_id])
}

/// The old stop-times query: every scheduled call at these stops on the current service date,
/// ordered by arrival time, with **no window and no limit** — a busy stop returns its whole
/// day. Enriched with the live vehicle running each trip where one is on the road.
fn stop_times_for(state: &AppState, stop_ids: &[String]) -> Response {
    let Some(idx) = state.gtfs.stop_indexes() else {
        return indexes_unavailable();
    };
    let Some(midnight) = local_midnight_utc(idx.date(), state.tz) else {
        return internal_error();
    };
    let live = state.latest_index();

    let mut rows: Vec<(i32, StopTimeItem)> = Vec::new();
    for stop_id in stop_ids {
        for d in idx.calls_on_service_date(stop_id) {
            let vehicle = d
                .realtime_trip_id
                .and_then(|rt| live.get_by_realtime_trip_id(rt));
            rows.push((
                d.scheduled_arrival,
                StopTimeItem {
                    realtime_trip_id: d.realtime_trip_id.unwrap_or_default().to_string(),
                    stop_id: d.stop.stop_id.clone(),
                    line_number: d.route.map(|r| r.short_name.clone()),
                    agency: d.route.and_then(|r| r.agency_id.clone()),
                    vehicle_number: vehicle.map(|v| v.key.vehicle_number.clone()),
                    punctuality: vehicle.map(|v| v.delay_seconds),
                    scheduled_arrival: rfc3339(
                        midnight + Duration::seconds(d.scheduled_arrival as i64),
                    ),
                    headsign: Some(d.trip.headsign.clone()),
                    latitude: vehicle.map(|v| v.lat),
                    longitude: vehicle.map(|v| v.lon),
                },
            ));
        }
    }
    // The old SQL ordered by arrival_time across all requested stops.
    rows.sort_by_key(|(secs, _)| *secs);
    let stop_times: Vec<StopTimeItem> = rows.into_iter().map(|(_, v)| v).collect();

    Json(StopTimesResponse { stop_times }).into_response()
}
