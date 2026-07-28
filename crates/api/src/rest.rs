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

/// GET /v1/vehicles — snapshot of vehicles (optionally within a bbox / filtered).
pub async fn list_vehicles(
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
    Query(q): Query<VehicleQuery>,
) -> Response {
    let idx = state.latest_index();
    let filters = build_filters(&q);
    let hits: Vec<VehicleJson> = match q.bbox.as_deref().and_then(parse_bbox) {
        Some(bbox) => idx.query(bbox, &filters).into_iter().map(VehicleJson::from).collect(),
        None => idx.all(&filters).into_iter().map(VehicleJson::from).collect(),
    };
    Json(json!({ "count": hits.len(), "vehicles": hits })).into_response()
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
            state.limiters.remove(&id);
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
