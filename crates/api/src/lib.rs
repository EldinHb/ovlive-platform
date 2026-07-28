//! OVLive HTTP + WebSocket API: REST (JSON) for snapshots/detail/accounts/admin and a
//! protobuf WebSocket for the live viewport stream. See `docs.rs` for the served docs.

mod auth;
mod convert;
mod docs;
mod legacy;
mod rest;
mod state;
mod ws;

pub use state::{direct_limiter, AppState, LegacyLimits};

use axum::routing::{delete, get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

/// Build the full application router.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(rest::health))
        // accounts + keys
        .route("/v1/register", post(rest::register))
        .route("/v1/keys", post(rest::create_key).get(rest::list_keys))
        .route("/v1/keys/:id", delete(rest::delete_key))
        // data
        .route("/v1/vehicles", get(rest::list_vehicles))
        .route("/v1/vehicles/:id", get(rest::vehicle_detail))
        .route("/v1/stops/viewport", get(rest::stops_in_viewport))
        // The path parameter must stay named `stopId`: matchit rejects two different parameter
        // names at the same position, and the deprecated `/v1/stops/:stopId/stoptimes` sibling
        // owns that name until it is deleted.
        .route("/v1/stops/:stopId/departures", get(rest::stop_departures))
        .route("/v1/operators", get(rest::operators))
        .route("/v1/lines", get(rest::lines))
        .route("/v1/stream", get(ws::ws_handler))
        // admin
        .route("/v1/admin/users", get(rest::admin_users))
        .route("/v1/admin/keys", get(rest::admin_keys))
        .route("/v1/admin/keys/:id/revoke", post(rest::admin_revoke_key))
        .route("/v1/admin/keys/:id/unrevoke", post(rest::admin_unrevoke_key))
        .route("/v1/admin/users/:id/disable", post(rest::admin_disable_user))
        .route("/v1/admin/users/:id/enable", post(rest::admin_enable_user))
        // docs
        .route("/openapi.json", get(docs::openapi))
        .route("/docs", get(docs::scalar))
        // Deprecated compatibility surface for consumers of the pre-Rust API. Temporary —
        // delete this line and `legacy.rs` once they have migrated (see that module's docs).
        .merge(legacy::router())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
