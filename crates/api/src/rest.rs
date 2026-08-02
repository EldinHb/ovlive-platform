//! REST (JSON) endpoints: registration, API-key management, vehicle snapshot/detail,
//! filter metadata, and admin.

use std::collections::BTreeMap;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use ovlive_core::{BBox, Filters, LiveTrip, VehicleType};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::{AdminUser, BasicUser, OptionalApiKeyUser};
use crate::state::AppState;

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

fn type_str(t: VehicleType) -> &'static str {
    match t {
        VehicleType::Bus => "bus",
        VehicleType::Tram => "tram",
        VehicleType::Metro => "metro",
        VehicleType::Train => "train",
        VehicleType::Ferry => "ferry",
        VehicleType::Unknown => "unknown",
    }
}

fn parse_type(s: &str) -> Option<VehicleType> {
    match s.trim().to_ascii_lowercase().as_str() {
        "bus" => Some(VehicleType::Bus),
        "tram" => Some(VehicleType::Tram),
        "metro" => Some(VehicleType::Metro),
        "train" => Some(VehicleType::Train),
        "ferry" => Some(VehicleType::Ferry),
        _ => None,
    }
}

// ----------------------------------------------------------------------------
// Vehicle JSON
// ----------------------------------------------------------------------------

#[derive(Serialize)]
pub struct VehicleJson {
    pub id: String,
    /// OVapi `realtime_trip_id` (`"<dataowner>:<line>:<journey>"`) — the id the pre-Rust API
    /// used publicly. `None` until KV6 reports both the line and the journey.
    pub realtime_trip_id: Option<String>,
    pub dataowner: String,
    pub vehicle_number: String,
    pub line_public_number: Option<String>,
    pub line_planning_number: Option<String>,
    pub vehicle_type: &'static str,
    pub operator_name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub bearing: Option<f32>,
    pub delay_seconds: i32,
    /// Whether `delay_seconds` is a measurement. `false` means unknown, not on time — see the
    /// train notes in the OpenAPI description.
    pub delay_known: bool,
    pub destination: Option<String>,
    pub block_code: Option<String>,
    pub journey_number: Option<String>,
    pub at_stop: bool,
    pub current_stop_id: Option<String>,
    pub line_color: Option<String>,
    pub line_text_color: Option<String>,
    pub last_update: chrono::DateTime<chrono::Utc>,
}

impl From<&LiveTrip> for VehicleJson {
    fn from(t: &LiveTrip) -> Self {
        VehicleJson {
            id: t.id.clone(),
            realtime_trip_id: t.realtime_trip_id(),
            dataowner: t.key.dataowner.clone(),
            vehicle_number: t.key.vehicle_number.clone(),
            line_public_number: t.line_public_number.clone(),
            line_planning_number: t.line_planning_number.clone(),
            vehicle_type: type_str(t.vehicle_type),
            operator_name: t.operator_name.clone(),
            lat: t.lat,
            lon: t.lon,
            bearing: t.bearing.is_finite().then_some(t.bearing),
            delay_seconds: t.delay_seconds,
            delay_known: t.delay_known,
            destination: t.destination.clone(),
            block_code: t.block_code.clone(),
            journey_number: t.journey_number.clone(),
            at_stop: t.at_stop,
            current_stop_id: t.current_stop_id.clone(),
            line_color: t.line_color.clone(),
            line_text_color: t.line_text_color.clone(),
            last_update: t.last_update,
        }
    }
}

#[derive(Deserialize)]
pub struct VehicleQuery {
    /// "minLon,minLat,maxLon,maxLat"
    pub bbox: Option<String>,
    pub types: Option<String>,
    pub owners: Option<String>,
    pub search: Option<String>,
    /// Cap on returned vehicles. Absent = no cap, so existing snapshot consumers are
    /// unaffected; `total` always reports how many matched.
    pub limit: Option<usize>,
}

fn build_filters(q: &VehicleQuery) -> Filters {
    Filters {
        vehicle_types: q
            .types
            .as_deref()
            .map(|s| s.split(',').filter_map(parse_type).collect())
            .unwrap_or_default(),
        dataowners: q
            .owners
            .as_deref()
            .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
            .unwrap_or_default(),
        search: q.search.clone().unwrap_or_default(),
    }
}

fn parse_bbox(s: &str) -> Option<BBox> {
    let p: Vec<f64> = s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
    if p.len() != 4 {
        return None;
    }
    Some(BBox {
        min_lon: p[0],
        min_lat: p[1],
        max_lon: p[2],
        max_lat: p[3],
    })
}

/// Relevance rank of a search hit: 0 = the query *is* the vehicle number or the public line,
/// 1 = one of those starts with it, 2 = it matched something else (planning, omloop or journey
/// number). `needle` must already be lowercase.
///
/// This only matters because of `limit`. A nationwide search for "1" matches ~2 800 vehicles
/// (measured on the live feed, 1.4 MB of JSON), so a UI that searches per keystroke has to ask
/// for a slice — and an arbitrary slice of that is useless, while the vehicles whose line *is*
/// 1 is what was asked for.
fn search_rank(t: &LiveTrip, needle: &str) -> u8 {
    let fields = [
        t.key.vehicle_number.as_str(),
        t.line_public_number.as_deref().unwrap_or(""),
    ];
    if fields.iter().any(|f| f.eq_ignore_ascii_case(needle)) {
        return 0;
    }
    if fields
        .iter()
        .any(|f| f.to_ascii_lowercase().starts_with(needle))
    {
        return 1;
    }
    2
}

/// Public line ordered numerically where it is a number ("2" before "10"), with lettered
/// lines (train type codes like `SPR`) after them.
fn line_sort_key(t: &LiveTrip) -> (u32, String) {
    let line = t.line_public_number.clone().unwrap_or_default();
    (line.parse().unwrap_or(u32::MAX), line)
}

/// GET /v1/vehicles — snapshot of vehicles (optionally within a bbox / filtered).
pub async fn list_vehicles(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<VehicleQuery>,
) -> Response {
    let idx = state.latest_index();
    let filters = build_filters(&q);
    let mut hits: Vec<&LiveTrip> = match q.bbox.as_deref().and_then(parse_bbox) {
        Some(bbox) => idx.query(bbox, &filters),
        None => idx.all(&filters),
    };
    let total = hits.len();
    // Rank before truncating, so `limit` returns the most relevant matches rather than
    // whichever ones the index happened to visit first.
    if !filters.search.is_empty() {
        let needle = filters.search.to_ascii_lowercase();
        hits.sort_by_cached_key(|t| {
            (
                search_rank(t, &needle),
                line_sort_key(t),
                t.key.vehicle_number.clone(),
            )
        });
    }
    if let Some(n) = q.limit {
        hits.truncate(n);
    }
    let vehicles: Vec<VehicleJson> = hits.into_iter().map(VehicleJson::from).collect();
    Json(json!({ "count": vehicles.len(), "total": total, "vehicles": vehicles })).into_response()
}

/// GET /v1/vehicles/:id — full detail including route shape + upcoming stops.
pub async fn vehicle_detail(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(trip) = state.live.get(&id) else {
        return err(StatusCode::NOT_FOUND, "vehicle not found");
    };
    let vehicle = VehicleJson::from(&trip);

    let mut shape: Vec<[f64; 2]> = Vec::new();
    let mut upcoming = Vec::new();
    if let (Some(store), Some(tid)) = (state.gtfs.current(), trip.matched_trip_id.as_deref()) {
        if let Some(pts) = store.shape_of_trip(tid) {
            shape = pts.clone();
        }
        upcoming = store.upcoming_stops(
            tid,
            trip.delay_seconds,
            trip.operating_day.as_deref(),
            trip.lat,
            trip.lon,
            trip.at_stop,
            chrono::Utc::now(),
        );
    }

    let next_trip = crate::convert::predict_next(&state.blocks, &trip).map(|n| {
        json!({
            "line_public_number": n.line_public_number,
            "destination": n.destination,
            "start_unix": n.start.timestamp(),
        })
    });

    Json(json!({
        "vehicle": vehicle,
        "route_shape": shape,
        "upcoming_stops": upcoming,
        "next_trip": next_trip,
    }))
    .into_response()
}

// ----------------------------------------------------------------------------
// Stops (map layer)
// ----------------------------------------------------------------------------

/// Largest viewport, in square degrees, the stop layer will answer for. The whole country is
/// ~6 deg², so this rejects country-wide requests: the layer is a zoomed-in detail (the web app
/// only asks from zoom 14), and answering huge boxes would mean scanning most of the grid and
/// serialising tens of thousands of quays on a public, keyless endpoint.
const MAX_STOPS_BBOX_AREA: f64 = 1.0;
const DEFAULT_STOPS_LIMIT: usize = 800;
const MAX_STOPS_LIMIT: usize = 2_000;

#[derive(Deserialize)]
pub struct StopsQuery {
    /// "minLon,minLat,maxLon,maxLat"
    pub bbox: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct StopJson {
    pub stop_id: String,
    pub name: String,
    /// `stops.txt.stop_code` — the operator's code. Not a GTFS key, and *not* comparable to
    /// `VehicleJson::current_stop_id` for most operators (see CLAUDE.md).
    pub code: Option<String>,
    pub platform_code: Option<String>,
    pub parent_station: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

impl From<&ovlive_gtfs::StopInfo> for StopJson {
    fn from(s: &ovlive_gtfs::StopInfo) -> Self {
        StopJson {
            stop_id: s.stop_id.clone(),
            name: s.name.clone(),
            code: s.code.clone(),
            platform_code: s.platform_code.clone(),
            parent_station: s.parent_station.clone(),
            lat: s.lat,
            lon: s.lon,
        }
    }
}

/// GET /v1/stops/viewport — boardable quays inside a bbox, nearest the centre first.
///
/// This is the supported stops endpoint, feeding the web app's stop layer. It is deliberately
/// *not* `/v1/stops`: that path belongs to the deprecated byte-compatible shim (camelCase keys,
/// `neLat`/`swLon` params) and must keep its old shape until it is deleted. This path stays put
/// afterwards — consumers are on it.
pub async fn stops_in_viewport(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<StopsQuery>,
) -> Response {
    let Some(bbox) = q.bbox.as_deref().and_then(parse_bbox) else {
        return err(StatusCode::BAD_REQUEST, "bbox is required as minLon,minLat,maxLon,maxLat");
    };
    let area = (bbox.max_lon - bbox.min_lon).abs() * (bbox.max_lat - bbox.min_lat).abs();
    if !area.is_finite() || area > MAX_STOPS_BBOX_AREA {
        return err(StatusCode::BAD_REQUEST, "bbox too large — zoom in");
    }
    let limit = q.limit.unwrap_or(DEFAULT_STOPS_LIMIT).clamp(1, MAX_STOPS_LIMIT);

    // The stop grid lives in the day-scoped indexes, which are absent for the first few seconds
    // after a cold boot (and while a feed swap rebuilds them).
    let Some(idx) = state.gtfs.stop_indexes() else {
        return err(StatusCode::SERVICE_UNAVAILABLE, "stop index not built yet");
    };
    let stops: Vec<StopJson> = idx
        .in_bbox(bbox.min_lat, bbox.min_lon, bbox.max_lat, bbox.max_lon, limit)
        .into_iter()
        .map(StopJson::from)
        .collect();

    // `truncated` tells a client its result is only the middle of the box, so it must not cache
    // the response as covering the whole viewport.
    let truncated = stops.len() >= limit;
    Json(json!({ "count": stops.len(), "truncated": truncated, "stops": stops })).into_response()
}

// ----------------------------------------------------------------------------
// Stop departure board
// ----------------------------------------------------------------------------

const DEFAULT_WINDOW_MIN: i32 = 90;
const MAX_WINDOW_MIN: i32 = 360;
const DEFAULT_DEPARTURES: usize = 25;
const MAX_DEPARTURES: usize = 100;
/// Keep a departure on the board for a minute after its time, so the vehicle pulling away
/// right now doesn't vanish from under the reader's cursor.
const DEPARTURE_GRACE_SECS: i32 = 60;

#[derive(Deserialize)]
pub struct DeparturesQuery {
    /// Minutes ahead to look (default 90, max 360).
    pub window: Option<i32>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct DepartureJson {
    pub trip_id: String,
    pub realtime_trip_id: Option<String>,
    /// The live vehicle running this trip (`"<dataowner>:<vehicle_number>"`), when one is on
    /// the road — this is the id to open in `/v1/vehicles/{id}`. `None` for a trip that has
    /// not started reporting yet.
    pub vehicle_id: Option<String>,
    pub vehicle_lat: Option<f64>,
    pub vehicle_lon: Option<f64>,
    pub line: String,
    pub vehicle_type: &'static str,
    /// GTFS `agency_id` of the route (e.g. `GVB`), not the operational dataowner.
    pub operator: Option<String>,
    pub headsign: String,
    pub stop_sequence: u32,
    /// Seconds since **today's** local midnight — the same axis as `upcoming_stops`. May be
    /// negative (yesterday's after-midnight service) or exceed 86400.
    pub scheduled_arrival: i32,
    pub scheduled_departure: i32,
    /// `scheduled_departure` shifted by the live vehicle's *trip-level* delay, which is the
    /// only realtime signal that joins here: BISON per-stop passages key on `UserStopCode`,
    /// which does not map to gtfs-nl `stop_id` (see CLAUDE.md). Equal to
    /// `scheduled_departure` while no vehicle is live.
    pub expected_departure: i32,
    pub delay_seconds: Option<i32>,
    /// The live vehicle reports dwelling at a stop (not necessarily *this* stop — see above).
    pub at_stop: bool,
    pub line_color: Option<String>,
    pub line_text_color: Option<String>,
}

/// GET /v1/stops/:stopId/departures — scheduled departures from a stop, enriched with the
/// live vehicle running each trip where there is one.
pub async fn stop_departures(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Path(stop_id): Path<String>,
    Query(q): Query<DeparturesQuery>,
) -> Response {
    let Some(idx) = state.gtfs.stop_indexes() else {
        return err(StatusCode::SERVICE_UNAVAILABLE, "stop index not built yet");
    };
    let Some(stop) = idx.store().stops.get(&stop_id) else {
        return err(StatusCode::NOT_FOUND, "stop not found");
    };
    let window = q.window.unwrap_or(DEFAULT_WINDOW_MIN).clamp(1, MAX_WINDOW_MIN) * 60;
    let limit = q.limit.unwrap_or(DEFAULT_DEPARTURES).clamp(1, MAX_DEPARTURES);

    let now = chrono::Utc::now();
    let from = ovlive_gtfs::secs_since_local_midnight(now, state.tz) - DEPARTURE_GRACE_SECS;
    let live = state.latest_index();

    let departures: Vec<DepartureJson> = idx
        .departures(&stop_id, from, window + DEPARTURE_GRACE_SECS, limit)
        .into_iter()
        .map(|d| {
            let vehicle = d.realtime_trip_id.and_then(|rt| live.get_by_realtime_trip_id(rt));
            let delay = vehicle.filter(|v| v.delay_known).map(|v| v.delay_seconds);
            DepartureJson {
                trip_id: d.trip.trip_id.clone(),
                realtime_trip_id: d.realtime_trip_id.map(str::to_string),
                vehicle_id: vehicle.map(|v| v.id.clone()),
                vehicle_lat: vehicle.map(|v| v.lat),
                vehicle_lon: vehicle.map(|v| v.lon),
                line: d.route.map(|r| r.short_name.clone()).unwrap_or_default(),
                vehicle_type: type_str(d.route.map(|r| r.vehicle_type).unwrap_or(VehicleType::Unknown)),
                operator: d.route.and_then(|r| r.agency_id.clone()),
                headsign: d.trip.headsign.clone(),
                stop_sequence: d.stop_sequence,
                scheduled_arrival: d.scheduled_arrival,
                scheduled_departure: d.scheduled_departure,
                expected_departure: d.scheduled_departure + delay.unwrap_or(0),
                delay_seconds: delay,
                at_stop: vehicle.is_some_and(|v| v.at_stop),
                line_color: d.route.and_then(|r| r.color.clone()),
                line_text_color: d.route.and_then(|r| r.text_color.clone()),
            }
        })
        .collect();

    Json(json!({
        "stop": StopJson::from(stop),
        "service_date": idx.date().to_string(),
        "departures": departures,
    }))
    .into_response()
}

/// GET /v1/operators — distinct dataowners currently live, with counts.
pub async fn operators(_auth: OptionalApiKeyUser, State(state): State<AppState>) -> Response {
    let idx = state.latest_index();
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for t in idx.all(&Filters::default()) {
        *counts.entry(t.key.dataowner.clone()).or_default() += 1;
    }
    let list: Vec<_> = counts
        .into_iter()
        .map(|(dataowner, count)| json!({ "dataowner": dataowner, "vehicles": count }))
        .collect();
    Json(json!({ "operators": list })).into_response()
}

/// GET /v1/lines — distinct public line numbers currently live, with type + count.
pub async fn lines(_auth: OptionalApiKeyUser, State(state): State<AppState>) -> Response {
    let idx = state.latest_index();
    let mut m: BTreeMap<String, (u32, &'static str)> = BTreeMap::new();
    for t in idx.all(&Filters::default()) {
        if let Some(line) = &t.line_public_number {
            let e = m.entry(line.clone()).or_insert((0, type_str(t.vehicle_type)));
            e.0 += 1;
        }
    }
    let list: Vec<_> = m
        .into_iter()
        .map(|(line, (count, vt))| json!({ "line": line, "type": vt, "vehicles": count }))
        .collect();
    Json(json!({ "lines": list })).into_response()
}

// ----------------------------------------------------------------------------
// Accounts + API keys
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RegisterReq {
    pub email: String,
    pub password: String,
}

/// POST /v1/register — self-service account creation.
pub async fn register(State(state): State<AppState>, Json(req): Json<RegisterReq>) -> Response {
    if !req.email.contains('@') {
        return err(StatusCode::BAD_REQUEST, "invalid email");
    }
    if req.password.len() < 8 {
        return err(StatusCode::BAD_REQUEST, "password must be at least 8 characters");
    }
    match state.db.register(&req.email, &req.password).await {
        Ok(user) => (StatusCode::CREATED, Json(json!({ "id": user.id, "email": user.email }))).into_response(),
        Err(_) => err(StatusCode::CONFLICT, "email already registered"),
    }
}

#[derive(Deserialize)]
pub struct CreateKeyReq {
    pub name: Option<String>,
    pub rate_per_min: Option<i32>,
}

/// POST /v1/keys — create an API key (Basic auth). The full key is returned ONCE.
pub async fn create_key(
    BasicUser(user): BasicUser,
    State(state): State<AppState>,
    Json(req): Json<CreateKeyReq>,
) -> Response {
    let name = req.name.unwrap_or_else(|| "default".into());
    let rate = req.rate_per_min.unwrap_or(120).clamp(1, 600);
    match state.db.create_api_key(user.id, &name, rate).await {
        Ok((key, full)) => (
            StatusCode::CREATED,
            Json(json!({
                "id": key.id,
                "name": key.name,
                "prefix": key.prefix,
                "rate_per_min": key.rate_per_min,
                "key": full,
                "note": "Store this key now — it will not be shown again."
            })),
        )
            .into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not create key"),
    }
}

/// GET /v1/keys — list your keys (never returns the secret).
pub async fn list_keys(BasicUser(user): BasicUser, State(state): State<AppState>) -> Response {
    match state.db.list_keys(user.id).await {
        Ok(keys) => Json(json!({ "keys": keys })).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not list keys"),
    }
}

/// DELETE /v1/keys/:id — delete one of your keys.
pub async fn delete_key(
    BasicUser(user): BasicUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    match state.db.delete_own_key(user.id, id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => err(StatusCode::NOT_FOUND, "key not found"),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not delete key"),
    }
}

// ----------------------------------------------------------------------------
// Admin
// ----------------------------------------------------------------------------

pub async fn admin_users(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match state.db.admin_list_users().await {
        Ok(users) => Json(json!({ "users": users })).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not list users"),
    }
}

pub async fn admin_keys(_admin: AdminUser, State(state): State<AppState>) -> Response {
    match state.db.admin_list_keys().await {
        Ok(keys) => Json(json!({ "keys": keys })).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not list keys"),
    }
}

pub async fn admin_revoke_key(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    set_revoked(&state, id, true).await
}

pub async fn admin_unrevoke_key(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    set_revoked(&state, id, false).await
}

async fn set_revoked(state: &AppState, id: Uuid, revoked: bool) -> Response {
    match state.db.admin_set_key_revoked(id, revoked).await {
        Ok(true) => {
            // Drop the cached limiter so a re-issued key starts fresh.
            state.limits.per_key.remove(&id);
            Json(json!({ "id": id, "revoked": revoked })).into_response()
        }
        Ok(false) => err(StatusCode::NOT_FOUND, "key not found"),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not update key"),
    }
}

pub async fn admin_disable_user(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    set_user_active(&state, id, false).await
}

pub async fn admin_enable_user(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Response {
    set_user_active(&state, id, true).await
}

async fn set_user_active(state: &AppState, id: Uuid, active: bool) -> Response {
    match state.db.admin_set_user_active(id, active).await {
        Ok(true) => Json(json!({ "id": id, "is_active": active })).into_response(),
        Ok(false) => err(StatusCode::NOT_FOUND, "user not found"),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "could not update user"),
    }
}

/// GET /health — liveness + quick stats.
pub async fn health(State(state): State<AppState>) -> Response {
    Json(json!({
        "status": "ok",
        "live_vehicles": state.live.len(),
        "gtfs_loaded": state.gtfs.is_loaded(),
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ovlive_core::VehicleKey;

    fn trip(vehicle_number: &str, line: Option<&str>) -> LiveTrip {
        let mut t = LiveTrip::new(
            VehicleKey {
                dataowner: "GVB".into(),
                vehicle_number: vehicle_number.into(),
            },
            chrono::Utc::now(),
        );
        t.line_public_number = line.map(str::to_string);
        t
    }

    #[test]
    fn ranks_exact_line_and_vehicle_matches_first() {
        let q = "13";
        // Exact on the line, exact on the vehicle number, prefix, then a substring elsewhere.
        assert_eq!(search_rank(&trip("2010", Some("13")), q), 0);
        assert_eq!(search_rank(&trip("13", Some("5")), q), 0);
        assert_eq!(search_rank(&trip("1301", Some("5")), q), 1);
        assert_eq!(search_rank(&trip("139", Some("139")), q), 1);
        assert_eq!(search_rank(&trip("4130", Some("5")), q), 2);
    }

    #[test]
    fn orders_numeric_lines_before_lettered_ones_and_numerically() {
        let mut trips = [
            trip("1", Some("SPR")),
            trip("2", Some("10")),
            trip("3", Some("2")),
            trip("4", None),
        ];
        trips.sort_by_cached_key(line_sort_key);
        let lines: Vec<_> = trips.iter().map(|t| t.line_public_number.clone()).collect();
        // "2" before "10" (numeric, not lexicographic); no line and lettered lines last.
        assert_eq!(
            lines,
            vec![Some("2".into()), Some("10".into()), None, Some("SPR".into())]
        );
    }
}
